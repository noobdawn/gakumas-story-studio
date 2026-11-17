using System;
using System.Collections.Generic;
using UnityEngine;

// A transparent dialogue layer for the same preview/export compositor.
public sealed class CreatorDialogueLayer:IDisposable {
 readonly CreatorUIGraph graph;readonly Font font;Texture panel,name;string signature;
 public CreatorDialogueLayer(Shader shader){font=Font.CreateDynamicFontFromOSFont("Microsoft YaHei",24);graph=new CreatorUIGraph(shader,null,key=>key=="font"?font.material.mainTexture:key=="panel"?panel:key=="name"?name:Texture2D.whiteTexture,4096);}
 static CreatorUIDraw Quad(string texture,float x,float y,float w,float h,int width,int height,Color color){return new CreatorUIDraw{texture=texture,points=new[]{x/width,1-(y+h)/height,(x+w)/width,1-(y+h)/height,(x+w)/width,1-y/height,x/width,1-y/height},uv=new[]{0f,0f,1f,1f},linearInput=texture=="panel"||texture=="name",color=new[]{color.r,color.g,color.b,color.a}};}
 void Text(List<CreatorUIDraw> list,string text,float x,float y,float width,float height,int size,int w,int h,Color color){float cursor=x,baseline=y+size;foreach(char c in text??""){if(c=='\r')continue;if(c=='\n'){cursor=x;baseline+=size*1.25f;continue;}if(!font.GetCharacterInfo(c,out var g,size))continue;if(cursor+g.advance>x+width){cursor=x;baseline+=size*1.25f;}if(baseline>y+height)break;var q=Quad("font",cursor+g.minX,baseline-g.maxY,g.maxX-g.minX,g.maxY-g.minY,w,h,color);q.alphaOnly=true;q.vertexUV=new[]{g.uvBottomLeft.x,g.uvBottomLeft.y,g.uvBottomRight.x,g.uvBottomRight.y,g.uvTopRight.x,g.uvTopRight.y,g.uvTopLeft.x,g.uvTopLeft.y};list.Add(q);cursor+=g.advance;}}
 public Texture Render(int w,int h,string speaker,string text,string style,Texture boxTexture,Texture nameTexture,float offsetX=0,float offsetY=0,float zoom=1,float opacity=1,string nameTextColor=null){
  string key=w+"/"+h+"/"+speaker+"/"+text+"/"+style+"/"+(boxTexture?boxTexture.GetInstanceID():0)+"/"+(nameTexture?nameTexture.GetInstanceID():0);
  // Re-request glyphs: a dynamic font atlas may have been rebuilt by IMGUI.
  panel=boxTexture;name=nameTexture;var list=new List<CreatorUIDraw>();
  if(!string.IsNullOrEmpty(text)){
   bool game=style=="game"&&panel&&name;int size=Mathf.Clamp(Mathf.RoundToInt(h*(game?.045f:.033f)),14,56);font.RequestCharactersInTexture((speaker??"")+text,size,FontStyle.Normal);
   float x=w*(game?.08f:.09f),y=h*(game?.70f:.72f),width=w*(game?.84f:.82f),height=h*(game?.25f:.22f);
   Color nameInk=ColorUtility.TryParseHtmlString(nameTextColor,out var parsedInk)?parsedInk:Color.white;
   if(game){list.Add(Quad("panel",x,y,width,height,w,h,Color.white));list.Add(Quad("name",x,y-h*.065f,width*.44f,h*.07f,w,h,Color.white));Text(list,speaker,x+w*.025f,y-h*.06f,width*.40f,h*.065f,size,w,h,nameInk);Text(list,text,x+w*.04f,y+h*.025f,width-w*.08f,height-h*.04f,size,w,h,new Color(.2f,.2f,.2f));}
   else{if(style!="subtitle")list.Add(Quad("",x,y,width,height,w,h,new Color(.08f,.08f,.1f,.85f)));if(style=="subtitle"){foreach(var d in new[]{new Vector2(-1,0),new Vector2(1,0),new Vector2(0,-1),new Vector2(0,1)}){Text(list,speaker,x+12+d.x,y+6+d.y,width-24,height*.3f,size,w,h,Color.black);Text(list,text,x+12+d.x,y+height*.3f+d.y,width-24,height*.65f,size,w,h,Color.black);}}Text(list,speaker,x+12,y+6,width-24,height*.3f,size,w,h,Color.white);Text(list,text,x+12,y+height*.3f,width-24,height*.65f,size,w,h,Color.white);}
  }
  // Text alpha and metrics use the current atlas; changing it invalidates cache.
  foreach(var d in list){for(int i=0;i<4;i++){d.points[i*2]=(d.points[i*2]-.5f)*zoom+.5f+offsetX;d.points[i*2+1]=(d.points[i*2+1]-.5f)*zoom+.5f+offsetY;}d.color[3]*=opacity;}
  graph.Set(list.ToArray());signature=key;return graph.Render(w,h);
 }
 public void Dispose(){graph.Dispose();if(font)UnityEngine.Object.Destroy(font);}
}

