using System;
using System.Collections.Generic;

// Main-thread owned. Credits cover pending, executing AND unreported results.
// Taking an item never releases its credit or byte reservation.
public sealed class CreatorExportQueue<T> {
 public sealed class Item { public T Value; public int Index,Bytes; public bool Done; }
 readonly Queue<Item> pending=new Queue<Item>(),outstanding=new Queue<Item>();
 public readonly int Capacity,ByteLimit;
 public int Enqueued {get;private set;}
 public int Completed {get;private set;}
 public int Reported {get;private set;}
 public int Bytes {get;private set;}
 public int HighWater {get;private set;}
 public int ByteHighWater {get;private set;}
 public int FullCount {get;private set;}
 public CreatorExportQueue(int capacity,int byteLimit=2097152) {
  if((capacity!=1&&capacity!=4&&capacity!=8)||byteLimit<1)throw new ArgumentException("Invalid export queue capacity");
  Capacity=capacity;ByteLimit=byteLimit;
 }
 public bool TryAdd(int first,T[] values,int[] sizes) {
  if(first!=Enqueued||values==null||sizes==null||values.Length<1||values.Length>4||sizes.Length!=values.Length)throw new ArgumentException("Invalid export queue sequence/batch");
  long size=0;foreach(var n in sizes){if(n<1||n>ByteLimit)throw new ArgumentException("Invalid export queue item size");size+=n;}
  if(size>ByteLimit||values.Length>Capacity)throw new ArgumentException("Export batch exceeds queue limits");
  if(Enqueued-Reported+values.Length>Capacity||Bytes+size>ByteLimit){FullCount++;return false;}
  for(int i=0;i<values.Length;i++){var item=new Item{Value=values[i],Index=Enqueued++,Bytes=sizes[i]};pending.Enqueue(item);outstanding.Enqueue(item);Bytes+=sizes[i];}
  HighWater=Math.Max(HighWater,Enqueued-Reported);ByteHighWater=Math.Max(ByteHighWater,Bytes);return true;
 }
 public Item Take(){return pending.Count==0?null:pending.Dequeue();}
 public void Complete(Item item){if(item==null||item.Done||item.Index!=Completed)throw new InvalidOperationException("Export completion order mismatch");item.Done=true;Completed++;}
 public T[] Drain(){var result=new List<T>();while(outstanding.Count>0&&outstanding.Peek().Done){var item=outstanding.Dequeue();Bytes-=item.Bytes;Reported++;result.Add(item.Value);}return result.ToArray();}
}
