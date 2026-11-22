using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable] public sealed class CreatorClipMask {
    public string id,shape;
    public bool enabled,lockAspect;
    public float x,y,width,height,rotation,feather,radius;
    static bool Within(float v,float a,float b) => v>=a && v<=b;
    public static void Validate(CreatorClipMask[] masks) {
        if (masks==null) return;
        if (masks.Length>8) throw new ArgumentException("Too many clip masks");
        var ids=new HashSet<string>();
        foreach(var m in masks) {
            if(m==null || string.IsNullOrEmpty(m.id) || m.id.Length>100 || !ids.Add(m.id)
                || !(m.shape=="linear" || m.shape=="mirror" || m.shape=="circle" || m.shape=="rectangle")
                || !Within(m.x,-2,2) || !Within(m.y,-2,2) || !Within(m.width,.001f,4) || !Within(m.height,.001f,4)
                || !Within(m.rotation,-36000,36000) || !Within(m.feather,0,1) || !Within(m.radius,0,1))
                throw new ArgumentException("Invalid clip mask");
        }
    }
}

[Serializable] public sealed class CreatorMaskEdit {public string layerId,maskId;}
[Serializable] public sealed class CreatorMaskDrag {public string maskId,phase; public float x,y,width,height;}

// Map mask-local UVs through the media quad and the outer composition transform.
public sealed class CreatorMaskHandles {
    CreatorClipMask mask;
    CreatorCompositionLayout layout;
    Vector2 origin,right,up;
    Vector2 down;
    CreatorClipMask initial;
    int control;
    bool resize;
    readonly Queue<CreatorMaskDrag> events=new Queue<CreatorMaskDrag>();
    public void Set(CreatorClipMask next,CreatorCompositionLayout transform,float[] quad) {
        if(mask?.id!=next?.id){initial=null;events.Clear();}
        mask=next;layout=transform??new CreatorCompositionLayout();
        origin=quad==null?Vector2.zero:new Vector2(quad[0],quad[1]);
        right=quad==null?Vector2.right:new Vector2(quad[2],quad[3])-origin;
        up=quad==null?Vector2.up:new Vector2(quad[6],quad[7])-origin;
    }
    public CreatorMaskDrag Take() {return events.Count>0?events.Dequeue():null;}
    Vector2 ScreenPoint(Vector2 uv) {
        var q=layout.Point(origin+uv.x*right+uv.y*up,(float)Screen.width/Screen.height);
        return new Vector2(q.x*Screen.width,(1-q.y)*Screen.height);
    }
    static float Cross(Vector2 a,Vector2 b)=>a.x*b.y-a.y*b.x;
    Vector2 Local(Vector2 p) {
        var a=ScreenPoint(Vector2.zero);var b=ScreenPoint(Vector2.right)-a;var c=ScreenPoint(Vector2.up)-a;
        return new Vector2(Cross(p-a,c),Cross(b,p-a))/Cross(b,c);
    }
    float Aspect() {
        var pixels=new Vector2(Screen.width,Screen.height);
        return Mathf.Max(.0001f,Vector2.Scale(right,pixels).magnitude/Mathf.Max(.0001f,Vector2.Scale(up,pixels).magnitude));
    }
    Vector2 Rotate(Vector2 v,float angle) {
        float aspect=Aspect(),a=angle*Mathf.Deg2Rad,s=Mathf.Sin(a),c=Mathf.Cos(a);
        return new Vector2(c*v.x-s*v.y/aspect,s*v.x*aspect+c*v.y);
    }
    static void Line(Vector2 a,Vector2 b) {
        var save=GUI.matrix;GUIUtility.RotateAroundPivot(Vector2.SignedAngle(Vector2.right,b-a),a);
        GUI.DrawTexture(new Rect(a.x,a.y,Vector2.Distance(a,b),1),Texture2D.whiteTexture);GUI.matrix=save;
    }
    public bool Draw() {
        if(initial==null && control!=0){if(GUIUtility.hotControl==control)GUIUtility.hotControl=0;control=0;}
        if(mask==null)return false;
        var center=new Vector2(.5f+mask.x,.5f+mask.y);
        Vector2 Point(float x,float y)=>ScreenPoint(center+Rotate(new Vector2(x,y),mask.rotation));
        bool band=mask.shape=="mirror",line=mask.shape=="linear";
        float w=mask.width/2,h=mask.height/2;
        var handle=Point(line?0:band?0:w,line?0:h);
        var e=Event.current;int id=GUIUtility.GetControlID(FocusType.Passive);
        if(e.type==EventType.Repaint){
            var saved=GUI.color;GUI.color=Color.cyan;
            if(line||band){Line(Point(-1,band?h:0),Point(1,band?h:0));if(band)Line(Point(-1,-h),Point(1,-h));}
            else if(mask.shape=="circle"){var prev=Point(w,0);for(int i=1;i<=48;i++){float a=i*Mathf.PI/24;var p=Point(w*Mathf.Cos(a),h*Mathf.Sin(a));Line(prev,p);prev=p;}}
            else{Line(Point(-w,-h),Point(w,-h));Line(Point(w,-h),Point(w,h));Line(Point(w,h),Point(-w,h));Line(Point(-w,h),Point(-w,-h));}
            var centerHandle=Point(0,0);GUI.DrawTexture(new Rect(centerHandle.x-4,centerHandle.y-4,9,9),Texture2D.whiteTexture);
            if(!line)GUI.DrawTexture(new Rect(handle.x-5,handle.y-5,11,11),Texture2D.whiteTexture);GUI.color=saved;
        }
        if(e.type==EventType.MouseDown && e.button==0) {
            resize=!line && Vector2.Distance(handle,e.mousePosition)<14;
            var hit=Rotate(Local(e.mousePosition)-center,-mask.rotation);
            if(!resize && Vector2.Distance(Point(0,0),e.mousePosition)>12 && (line?Mathf.Abs(hit.y)>.025f:band?Mathf.Abs(hit.y)>h:Mathf.Abs(hit.x)>w||Mathf.Abs(hit.y)>h))return true;
            control=id;GUIUtility.hotControl=id;initial=mask;down=Local(e.mousePosition);
        } else if(initial==null || control!=GUIUtility.hotControl || (e.type!=EventType.MouseUp && e.type!=EventType.MouseDrag))return true;
        var delta=Local(e.mousePosition)-down;
        var edit=new CreatorMaskDrag{maskId=initial.id,phase=e.type==EventType.MouseDown?"begin":e.type==EventType.MouseUp?"end":"move",x=initial.x,y=initial.y,width=initial.width,height=initial.height};
        if(resize){
            delta=Rotate(delta,-initial.rotation);
            if(!band)edit.width=Mathf.Clamp(initial.width+2*delta.x,.001f,4);
            edit.height=Mathf.Clamp(initial.height+2*delta.y,.001f,4);
            if(initial.lockAspect&&!band){float ratio=Mathf.Clamp(edit.width/initial.width,.001f/Mathf.Min(initial.width,initial.height),4/Mathf.Max(initial.width,initial.height));edit.width=initial.width*ratio;edit.height=initial.height*ratio;}
        }else{edit.x=Mathf.Clamp(initial.x+delta.x,-2,2);edit.y=Mathf.Clamp(initial.y+delta.y,-2,2);}
        if(events.Count>0 && events.Peek().phase=="move")events.Dequeue();
        events.Enqueue(edit);
        if(edit.phase=="end"){GUIUtility.hotControl=0;control=0;initial=null;}
        e.Use();return true;
    }
}
