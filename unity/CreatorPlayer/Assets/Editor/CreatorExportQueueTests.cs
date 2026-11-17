using System;

public static class CreatorExportQueueTests {
 static void Check(bool ok){if(!ok)throw new Exception("Export queue invariant failed");}
 static void Reject(Action action){try{action();}catch(ArgumentException){return;}catch(InvalidOperationException){return;}throw new Exception("Expected export queue rejection");}
 public static void Run(){
  var q=new CreatorExportQueue<int>(4,100);
  Check(q.TryAdd(0,new[]{10,11},new[]{30,30}));
  var a=q.Take();var b=q.Take();Check(q.Bytes==60&&q.Reported==0);
  Check(!q.TryAdd(2,new[]{12,13},new[]{30,30})&&q.Enqueued==2);
  Reject(()=>q.Complete(b));q.Complete(a);
  Check(q.Bytes==60);Check(q.Drain()[0]==10&&q.Bytes==30);
  Check(q.TryAdd(2,new[]{12,13},new[]{30,30}));q.Complete(b);
  Check(!q.TryAdd(4,new[]{14},new[]{30}));q.Drain();
  q.Complete(q.Take());q.Complete(q.Take());Check(q.Drain().Length==2&&q.Bytes==0);
  Reject(()=>q.Complete(a));Reject(()=>q.TryAdd(3,new[]{1},new[]{1}));
  var one=new CreatorExportQueue<int>(1);Check(one.TryAdd(0,new[]{7},new[]{8}));
  var active=one.Take();Check(!one.TryAdd(1,new[]{8},new[]{8}));one.Complete(active);
  Check(!one.TryAdd(1,new[]{8},new[]{8}));Check(one.Drain()[0]==7);Check(one.TryAdd(1,new[]{8},new[]{8}));
  var atomic=new CreatorExportQueue<int>(4,100);Reject(()=>atomic.TryAdd(0,new[]{1,2},new[]{1,-1}));Check(atomic.Enqueued==0&&atomic.Bytes==0);
  Reject(()=>atomic.TryAdd(0,new[]{1,2},new[]{60,60}));Check(atomic.Enqueued==0);
 }
}
