using System;
using UnityEngine;

public enum ActorPhysicsMode { None, Gss, Quartz, Hybrid }

// The timeline advances even when a base pose is held or a clip wraps.
public sealed class ActorPhysicsPlayback
{
    public struct BlendPose
    {
        public string motion;
        public float time,weight;
        public bool Same(BlendPose other)=>motion==other.motion && time==other.time && weight==other.weight;
        internal (string clip,float sampleTime) Dominant(string baseClip,float baseTime) =>
            !string.IsNullOrEmpty(motion) && weight>.5f ? (motion,time) : (baseClip,baseTime);
    }
    const float Step = 1f / 60f;
    public readonly struct Clock
    {
        public readonly double seconds;
        public readonly int tick;
        Clock(double seconds,int tick){this.seconds=seconds;this.tick=tick;}
        public static Clock FromFrame(int frame,int rate) => new Clock(frame/(double)rate,frame*60/rate);
        public static implicit operator Clock(double time) => new Clock(time,(int)Math.Floor(time*60+1e-9));
        public static Clock FromLegacyTime(float time)
        {
            int nearest=(int)Math.Round((double)time*60);
            return (float)(nearest/60.0)==time?FromFrame(nearest,60):(Clock)(double)time;
        }
    }
    Clock previousClock = -1d;
    float previousBase;
    string previousMotion;
    string previousPlacement;
    CreatorMotionLayer[] previousLayers;
    Vector3 position, scale;
    Quaternion rotation;
    Matrix4x4 previousWorldToLocal;
    ActorPhysicsMode previousMode=ActorPhysicsMode.Quartz;
    BlendPose previousBlend;
    public int Revision { get; private set; }
    public double DisplayTime => previousClock.seconds;

    public static ActorPhysicsMode ResolveMode(string method,bool legacyEnabled)
    {
        switch(method)
        {
            case null:
            case "": return legacyEnabled ? ActorPhysicsMode.Quartz : ActorPhysicsMode.None;
            case "none": return ActorPhysicsMode.None;
            case "gss": return ActorPhysicsMode.Gss;
            case "quartz": return ActorPhysicsMode.Quartz;
            case "hybrid": return ActorPhysicsMode.Hybrid;
            default: throw new ArgumentException("Unknown physics method: "+method);
        }
    }

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

    public void Apply(bool enabled, Clock clock, string motion, float localTime, float duration,
                      CreatorMotionLayer[] layers, Transform root, ActorClothPhysics[] solvers,
                      Action<float, CreatorMotionLayer[]> sample, string placement = null, ActorPhysicsMode mode = ActorPhysicsMode.Quartz,
                      BlendPose blend = default, Action<float,float> sampleBlend = null, CreatorGazePose gaze = null)
    {
        if(previousMode!=mode)
        {
            foreach(var solver in solvers)solver.SetMode(mode);
            previousMode=mode;previousClock=-1;
        }
        layers = layers ?? Array.Empty<CreatorMotionLayer>();
        if (!enabled || solvers.Length == 0)
        {
            if (previousClock.seconds >= 0) foreach (var solver in solvers) solver.ResetSimulation();
            previousClock = -1;
            sample(localTime, layers);
            Revision++;
            return;
        }
        bool sameLayout = previousClock.seconds >= 0 && SameLayout(previousLayers, layers);
        bool sameMoment = previousClock.seconds == clock.seconds;
        bool moved = position != root.position || rotation != root.rotation || scale != root.lossyScale;
        bool samePose = previousMotion == motion && previousBase == localTime && sameLayout && SameValues(previousLayers, layers) && previousBlend.Same(blend);
        if(gaze!=null&&(gaze.Changed||(gaze.Active&&moved)))samePose=false;
        if (sameMoment && samePose && !moved) { previousPlacement=placement; return; }

        double elapsed=clock.seconds-previousClock.seconds;
        if (previousClock.seconds < 0 || elapsed < 0 || elapsed > .25 || (sameMoment && !samePose))
        {
            foreach (var solver in solvers) solver.ResetSimulation();
            sample(localTime, layers);
            for (int i = 0; i < 30; i++) foreach (var solver in solvers) solver.Step(Step);
        }
        else
        {
            float delta=localTime-previousBase;
            if(delta<0 && duration>0 && Mathf.Abs(delta+duration)<=elapsed+.001f)delta+=duration;
            bool poseCut=previousMotion!=motion || previousBlend.motion!=blend.motion || Mathf.Abs(delta)>elapsed+Step;
            bool movedPlacement=moved && (sameMoment || placement!=previousPlacement || LargeRootStep(root,(float)elapsed));
            if(poseCut)
            {
                sample(localTime,layers);
                // A direct clip can become the outgoing mixer input while still
                // supplying nearly the same head pose. Keep its contact history.
                var outgoing=previousBlend.Dominant(previousMotion,previousBase);
                var incoming=blend.Dominant(motion,localTime);
                bool continuousFade=mode==ActorPhysicsMode.Hybrid && previousBlend.motion!=blend.motion &&
                    outgoing.clip==incoming.clip && Mathf.Abs(incoming.sampleTime-outgoing.sampleTime)<=elapsed+Step;
                foreach(var solver in solvers)solver.MoveHistoryToCurrentAnchors(continuousFade);
            }
            else if(movedPlacement)
            {
                var map=root.localToWorldMatrix*previousWorldToLocal;
                foreach(var solver in solvers)solver.MoveHistory(map);
            }
            // Editing only the actor transform at a paused frame already moved the visible
            // hierarchy. Its Verlet samples must move with it, without an extra solver tick.
            if(sameMoment){RememberRoot(root,placement);return;}
            int first = previousClock.tick + 1, last = clock.tick;
            float end=previousBase+delta;
            CreatorMotionLayer[] intermediate = null;
            bool sampledFinal = false;
            bool followBlend=!poseCut && mode==ActorPhysicsMode.Hybrid && sampleBlend!=null &&
                previousBlend.weight!=blend.weight && Array.Exists(solvers,solver=>solver.IsHair);
            float lastWeight=previousBlend.weight;
            void SamplePose(float t,CreatorMotionLayer[] pose,float blendTime,float weight)
            {
                bool changing=followBlend && weight!=lastWeight;
                if(changing)
                {
                    // Same clip times and layers on both sides isolate the change
                    // introduced by the mixer from the actor's own head movement.
                    sampleBlend(blendTime,lastWeight);
                    sample(t,pose);
                    foreach(var solver in solvers)if(solver.IsHair)solver.CaptureBlendFrame();
                }
                if(!poseCut)sampleBlend?.Invoke(blendTime,weight);
                sample(t,pose);
                if(changing)foreach(var solver in solvers)if(solver.IsHair)solver.FollowBlendFrame();
                lastWeight=weight;
            }
            for (int tick = first; tick <= last; tick++)
            {
                float alpha = Mathf.Clamp01((float)((tick / 60.0 - previousClock.seconds) / elapsed));
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
                SamplePose(sampledFinal ? localTime : t,pose,Mathf.Lerp(previousBlend.time,blend.time,alpha),
                    Mathf.Lerp(previousBlend.weight,blend.weight,alpha));
                foreach (var solver in solvers) solver.Step(Step);
            }
            if (!sampledFinal)
            {
                if(poseCut)sampleBlend?.Invoke(blend.time,blend.weight);
                SamplePose(localTime,layers,blend.time,blend.weight);
                foreach (var solver in solvers) solver.ApplyCurrentPose();
            }
        }
        previousClock = clock;
        previousBase = localTime;
        previousMotion = motion;
        previousBlend = blend;
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
