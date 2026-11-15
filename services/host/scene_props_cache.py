"""Derive existing classroom prop IDs and transforms from the current bundle."""
import hashlib,json,math
import UnityPy
def mul(a,b):
 x,y,z,w=a;X,Y,Z,W=b
 return (w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z)
def rotate(q,v):return mul(mul(q,(*v,0)),(-q[0],-q[1],-q[2],q[3]))[:3]
def vec(v):return (v.x,v.y,v.z)
def world(t):
 q=t.m_LocalRotation;q=(q.x,q.y,q.z,q.w);p=vec(t.m_LocalPosition);s=vec(t.m_LocalScale)
 if t.m_Father.path_id:
  pp,pq,ps=world(t.m_Father.read());v=rotate(pq,[p[i]*ps[i] for i in range(3)]);p=tuple(pp[i]+v[i] for i in range(3));q=mul(pq,q);s=tuple(ps[i]*s[i] for i in range(3))
 return p,q,s
def euler(q):
 a,b,c=[rotate(q,v) for v in ((1,0,0),(0,1,0),(0,0,1))];x=math.asin(max(-1,min(1,-c[1])))
 if abs(math.cos(x))>1e-6:y=math.atan2(c[0],c[2]);z=math.atan2(a[1],b[1])
 else:y=math.atan2(-a[2],a[0]);z=0
 return [math.degrees(v)%360 for v in (x,y,z)]
def build(root):
 source=root/'bundles/env_3d_adv_classroom-00-00-noon.bundle';env=UnityPy.load(str(source));items=[]
 go=next(o.read() for o in env.objects if o.type.name=='GameObject' and o.read().m_Name=='movable')
 parent=go.m_Component[0].component.read()
 for gi,gp in enumerate(parent.m_Children):
  group=gp.read();gn=group.m_GameObject.read().m_Name
  if gn=='decal':continue
  for i,cp in enumerate(group.m_Children):
   child=cp.read();name=child.m_GameObject.read().m_Name;p,q,_=world(child)
   items.append(dict(id=f'classroom-chair-{i}' if gn=='chair' else f'classroom-prop-{gi}-{i}',group=gn,groupName=gn,groupIndex=gi,index=i,source=name,name=name,position=list(p),rotation=euler(q)))
 report=dict(sha256=hashlib.sha256(source.read_bytes()).hexdigest(),items=items)
 (root/'player-view/classroom-props.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
 return report
