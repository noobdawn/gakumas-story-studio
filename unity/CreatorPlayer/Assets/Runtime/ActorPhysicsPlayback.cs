using System;
using UnityEngine;

// The timeline advances even when a base pose is held or a clip wraps.
public sealed class ActorPhysicsPlayback
{
    const float Step = 1f / 60f;
    float previousClock = -1, previousBase;
    string previousMotion;
    string previousPlacement;
    CreatorMotionLayer[] previousLayers;
    Vector3 position, scale;
    Quaternion rotation;
    Matrix4x4 previousWorldToLocal;
    public int Revision { get; private set; }

    static bool SameLayout(CreatorMotionLayer[] a, CreatorMotionLayer[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++)
            if (a[i].id != b[i].id || a[i].motionId != b[i].motionId ||
                a[i].scope != b[i].scope || a[i].additive != b[i].additive) return false;
        return true;
    }

    static bool SameValues(CreatorMotionLayer[] a, CreatorMotionLayer[] b)
    {
        for (int i = 0; i < a.Length; i++)
            if (a[i].time != b[i].time || a[i].weight != b[i].weight) return false;
        return true;
    }

    static int Tick(float time) => (int)Math.Floor((double)time * 60 + .0001);

    public void Apply(bool enabled, float clock, string motion, float localTime, float duration,
                      CreatorMotionLayer[] layers, Transform root, ActorClothPhysics[] solvers,
                      Action<float, CreatorMotionLayer[]> sample, string placement = null)
    {
        layers = layers ?? Array.Empty<CreatorMotionLayer>();
        if (!enabled || solvers.Length == 0)
        {
            if (previousClock >= 0) foreach (var solver in solvers) solver.ResetSimulation();
            previousClock = -1;
            sample(localTime, layers);
            Revision++;
            return;
        }
        bool sameLayout = previousClock >= 0 && SameLayout(previousLayers, layers);
        bool sameMoment = previousClock == clock;
        bool moved = position != root.position || rotation != root.rotation || scale != root.lossyScale;
        bool samePose = previousMotion == motion && previousBase == localTime && sameLayout && SameValues(previousLayers, layers);
        if (sameMoment && samePose && !moved) { previousPlacement=placement; return; }

        float elapsed=clock-previousClock;
        if (previousClock < 0 || elapsed < 0 || elapsed > .25f || (sameMoment && !samePose))
        {
            foreach (var solver in solvers) solver.ResetSimulation();
            sample(localTime, layers);
            for (int i = 0; i < 30; i++) foreach (var solver in solvers) solver.Step(Step);
        }
        else
        {
            float delta=localTime-previousBase;
            if(delta<0 && duration>0 && Mathf.Abs(delta+duration)<=elapsed+.001f)delta+=duration;
            bool poseCut=previousMotion!=motion || Mathf.Abs(delta)>elapsed+Step;
            bool movedPlacement=moved && (sameMoment || placement!=previousPlacement || LargeRootStep(root,elapsed));
            if(poseCut)
            {
                sample(localTime,layers);
                foreach(var solver in solvers)solver.MoveHistoryToCurrentAnchors();
            }
            else if(movedPlacement)
            {
                var map=root.localToWorldMatrix*previousWorldToLocal;
                foreach(var solver in solvers)solver.MoveHistory(map);
            }
            // Editing only the actor transform at a paused frame already moved the visible
            // hierarchy. Its Verlet samples must move with it, without an extra solver tick.
            if(sameMoment){RememberRoot(root,placement);return;}
            int first = Tick(previousClock) + 1, last = Tick(clock);
            float end=previousBase+delta;
            CreatorMotionLayer[] intermediate = null;
            bool sampledFinal = false;
            for (int tick = first; tick <= last; tick++)
            {
                float alpha = Mathf.Clamp01((float)((tick / 60.0 - previousClock) / (clock - previousClock)));
                sampledFinal = alpha >= .9999f;
                var pose = layers;
                if (!sampledFinal && sameLayout && layers.Length > 0)
                {
                    if (intermediate == null)
                    {
                        intermediate = new CreatorMotionLayer[layers.Length];
                        for (int i = 0; i < layers.Length; i++)
                            intermediate[i] = new CreatorMotionLayer { id=layers[i].id, motionId=layers[i].motionId,
                                scope=layers[i].scope, additive=layers[i].additive };
                    }
                    for (int i = 0; i < layers.Length; i++)
                    {
                        intermediate[i].time = layers[i].time < previousLayers[i].time ? layers[i].time :
                            Mathf.Lerp(previousLayers[i].time, layers[i].time, alpha);
                        intermediate[i].weight = Mathf.Lerp(previousLayers[i].weight, layers[i].weight, alpha);
                    }
                    pose = intermediate;
                }
                float t = poseCut ? localTime : Mathf.Lerp(previousBase, end, alpha);
                if (t >= duration && duration > 0) t -= duration;
                sample(sampledFinal ? localTime : t, pose);
                foreach (var solver in solvers) solver.Step(Step);
            }
            if (!sampledFinal)
            {
                sample(localTime, layers);
                foreach (var solver in solvers) solver.ApplyCurrentPose();
            }
        }
        previousClock = clock;
        previousBase = localTime;
        previousMotion = motion;
        previousLayers = layers;
        RememberRoot(root,placement);
        Revision++;
    }
    void RememberRoot(Transform root,string placement)
    {
        position=root.position;rotation=root.rotation;scale=root.lossyScale;
        previousWorldToLocal=root.worldToLocalMatrix;previousPlacement=placement;
    }
    bool LargeRootStep(Transform root,float elapsed)
    {
        // Legacy snapshots and abrupt keyframes within one placement have no clip boundary.
        float limit=Mathf.Max(.20f,5f*elapsed);
        var localDelta=previousWorldToLocal.MultiplyVector(root.position-position);
        var s=root.lossyScale;
        return localDelta.sqrMagnitude>limit*limit || Quaternion.Angle(rotation,root.rotation)>Mathf.Max(30f,360f*elapsed) ||
            Mathf.Abs(s.x-scale.x)>.15f*Mathf.Abs(scale.x) || Mathf.Abs(s.y-scale.y)>.15f*Mathf.Abs(scale.y) ||
            Mathf.Abs(s.z-scale.z)>.15f*Mathf.Abs(scale.z);
    }
}
