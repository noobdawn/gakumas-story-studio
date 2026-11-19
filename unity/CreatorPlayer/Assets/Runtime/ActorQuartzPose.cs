using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// Pose-dependent model helpers. All bind rotations and references belong to one prefab instance.
public sealed class ActorQuartzPose
{
    [Serializable] public sealed class Profile
    {
        public string source;
        public Driver[] drivers;
        public Layer[] layers;
        public Limit[] limits;
    }
    [Serializable] public sealed class Driver
    {
        public string kind, bone, referenceBone, referenceHeadBone, referenceNeckBone;
        public int rotationOrder;
        public Vector3 innerCoefficient, outerCoefficient, limitMin, limitMax, coefficient;
        public Vector3 headRotateCoefficient, headRotateLimitMin, headRotateLimitMax;
        public Vector3 neckRotateCoefficient, neckRotateLimitMin, neckRotateLimitMax;
        public float twistCoefficient;
    }
    [Serializable] public sealed class Layer
    {
        public string[] bones;
        public bool around;
        public float radius, smoothing;
    }
    [Serializable] public sealed class Limit
    {
        public string bone;
        public Vector3 minimum, maximum;
    }
    sealed class Binding
    {
        public Driver driver;
        public Transform target, source, neck;
        public Quaternion rest, inverseSource, inverseNeck;
        public Vector3 inner, outer, low, high;
    }
    readonly List<Binding> bindings = new List<Binding>();
    public int Skirts { get; private set; }
    public int Hair { get; private set; }
    public int Count => bindings.Count;
    public float MaxSkirtAngle { get; private set; }
    public float MaxHairAngle { get; private set; }

    public ActorQuartzPose(Transform root, IDictionary<string,Transform> bones, Driver[] drivers)
    {
        Transform Find(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            if (bones.TryGetValue(name, out var bone)) return bone;
            // Standalone hair prefabs are attached to their own actor's head.
            for (var parent = root.parent; parent; parent = parent.parent)
                if (parent.name == name) return parent;
            return null;
        }
        foreach (var d in drivers)
        {
            var b = new Binding { driver = d, target = Find(d.bone) };
            if (d.kind == "HairBone")
            {
                b.source = Find(string.IsNullOrEmpty(d.referenceHeadBone) ? "Head" : d.referenceHeadBone);
                b.neck = Find(string.IsNullOrEmpty(d.referenceNeckBone) ? "Neck" : d.referenceNeckBone);
            }
            else if (d.kind.StartsWith("Humanoid", StringComparison.Ordinal))
                b.source = Find(d.bone.Replace("_Roll_H", "").Replace("_H", ""));
            else b.source = Find(d.referenceBone);
            if (!b.target || !b.source || (d.kind == "HairBone" && !b.neck)) continue;
            b.rest = b.target.localRotation;
            b.inverseSource = Quaternion.Inverse(b.source.localRotation);
            if (b.neck) b.inverseNeck = Quaternion.Inverse(b.neck.localRotation);
            if (d.kind == "SkirtBone")
            {
                Skirts++;
                b.inner = d.innerCoefficient; b.outer = d.outerCoefficient;
                b.low = d.limitMin; b.high = d.limitMax;
                // The authored flexion axis and the left thigh's lateral axis have opposite signs.
                FlipAxis(b, 2);
                if (b.source.name.StartsWith("Left", StringComparison.Ordinal)) FlipAxis(b, 1);
            }
            if (d.kind == "HairBone") Hair++;
            bindings.Add(b);
        }
        // A referenced helper must be evaluated before any driver that reads it.
        var ordered = new List<Binding>(bindings.Count);
        var pending = new HashSet<Transform>(bindings.Select(b => b.target));
        while (pending.Count > 0)
        {
            int before = pending.Count;
            foreach (var b in bindings)
                if (pending.Contains(b.target) && !pending.Contains(b.source) && (!b.neck || !pending.Contains(b.neck)))
                { ordered.Add(b); pending.Remove(b.target); }
            if (before == pending.Count) throw new InvalidOperationException("Cyclic Quartz references in " + root.name);
        }
        bindings = ordered;
    }
    static void FlipAxis(Binding b, int axis)
    {
        b.inner[axis] = -b.inner[axis]; b.outer[axis] = -b.outer[axis];
        float low = b.low[axis]; b.low[axis] = -b.high[axis]; b.high[axis] = -low;
    }
    public void Reset()
    {
        foreach (var b in bindings) b.target.localRotation = b.rest;
        MaxSkirtAngle = MaxHairAngle = 0;
    }
    static float Signed(float angle) => Mathf.DeltaAngle(0, angle);
    static Vector3 Components(Quaternion q) => new Vector3(q.x, q.y, q.z);
    static Vector3 EulerXYZ(Quaternion q)
    {
        // Decompose a local rotation applied about X, then Y, then Z.
        return Mathf.Rad2Deg * new Vector3(
            Mathf.Atan2(2*(q.w*q.x+q.y*q.z), 1-2*(q.x*q.x+q.y*q.y)),
            Mathf.Asin(Mathf.Clamp(2*(q.w*q.y-q.x*q.z), -1, 1)),
            Mathf.Atan2(2*(q.w*q.z+q.x*q.y), 1-2*(q.y*q.y+q.z*q.z)));
    }
    static Vector3 Clamp(Vector3 v, Vector3 lo, Vector3 hi) => new Vector3(
        Mathf.Clamp(v.x,lo.x,hi.x), Mathf.Clamp(v.y,lo.y,hi.y), Mathf.Clamp(v.z,lo.z,hi.z));
    static Quaternion Swing(float twist, float lateral, float flex)
    {
        // Inverse stereographic projection into the helper's local X-axis frame.
        float scale = 2 / (1 + lateral*lateral + flex*flex);
        var axis = new Vector3(scale-1, flex*scale, lateral*scale);
        return Quaternion.AngleAxis(-twist, Vector3.right) * Quaternion.FromToRotation(Vector3.right, axis);
    }
    static Quaternion Skirt(Binding b, Quaternion relative)
    {
        var up = relative * Vector3.up;
        var twist = Quaternion.Euler(EulerXYZ(relative)) * Quaternion.Inverse(Quaternion.FromToRotation(Vector3.up, up));
        float angle = 2 * Mathf.Atan2(Components(twist).magnitude, twist.w) * Mathf.Rad2Deg;
        var input = new Vector3(Signed(Vector3.Dot(Components(twist), up) < 0 ? -angle : angle),
            Signed(-2*Mathf.Atan2(up.x, 1+up.y)*Mathf.Rad2Deg), Signed(2*Mathf.Atan2(up.z, 1+up.y)*Mathf.Rad2Deg));
        var inside = Clamp(input, b.low, b.high);
        var output = Vector3.Scale(inside, b.inner) + Vector3.Scale(input-inside, b.outer);
        return Swing(output.x, Mathf.Tan(.5f*Mathf.Deg2Rad*output.y), Mathf.Tan(-.5f*Mathf.Deg2Rad*output.z));
    }
    static Quaternion ReflectExportBasis(Quaternion q) => new Quaternion(q.x,-q.y,-q.z,q.w);
    static Vector3 HairChannels(Quaternion unityDelta, Vector3 coefficient, Vector3 low, Vector3 high)
    {
        // The reference hair calculation uses exported bone coordinates. Convert only at its boundaries.
        var q = ReflectExportBasis(unityDelta);
        float denom = q.w*q.w + q.y*q.y;
        var angles = new Vector3(2*Mathf.Atan2(q.z*q.y+q.x*q.w,denom),
            Mathf.Atan2(2*(q.w*q.y-q.z*q.x),1-2*(q.x*q.x+q.y*q.y)),
            2*Mathf.Atan2(q.z*q.w-q.x*q.y,denom)) * Mathf.Rad2Deg;
        return Vector3.Scale(Clamp(new Vector3(Signed(angles.x), Signed(angles.y), Signed(angles.z)), low, high), coefficient);
    }
    public void Apply()
    {
        MaxSkirtAngle = MaxHairAngle = 0;
        foreach (var b in bindings)
        {
            var d = b.driver;
            var live = b.source.localRotation;
            Quaternion extra;
            if (d.kind == "SkirtBone")
            {
                extra = Skirt(b, live*b.inverseSource);
                MaxSkirtAngle = Mathf.Max(MaxSkirtAngle, Quaternion.Angle(Quaternion.identity,extra));
            }
            else if (d.kind == "HairBone")
            {
                var angles = HairChannels(b.inverseSource*live, d.headRotateCoefficient, d.headRotateLimitMin, d.headRotateLimitMax)
                    + HairChannels(b.inverseNeck*b.neck.localRotation, d.neckRotateCoefficient, d.neckRotateLimitMin, d.neckRotateLimitMax);
                var q = Swing(angles.x, Mathf.Sin(.5f*Mathf.Deg2Rad*angles.y), Mathf.Sin(-.5f*Mathf.Deg2Rad*angles.z));
                extra = ReflectExportBasis(new Quaternion(q.z,q.x,q.y,q.w));
                MaxHairAngle = Mathf.Max(MaxHairAngle, Quaternion.Angle(Quaternion.identity,extra));
            }
            else if (d.kind == "RotationBone")
            {
                var angles = Clamp(Vector3.Scale(EulerXYZ(ReflectExportBasis(b.inverseSource*live)), d.coefficient), d.limitMin, d.limitMax);
                extra = ReflectExportBasis(d.rotationOrder == 1 ? Quaternion.Euler(angles) :
                    Quaternion.AngleAxis(angles.x,Vector3.right)*Quaternion.AngleAxis(angles.y,Vector3.up)*Quaternion.AngleAxis(angles.z,Vector3.forward));
            }
            else
            {
                var q = b.inverseSource*live;
                float roll = Signed(2*Mathf.Atan2(q.x,q.w)*Mathf.Rad2Deg);
                extra = Quaternion.AngleAxis(roll*d.twistCoefficient, Vector3.right);
            }
            b.target.localRotation = b.rest * extra;
        }
    }
}
