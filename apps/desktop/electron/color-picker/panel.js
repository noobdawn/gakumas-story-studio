(async()=>{
 const $=id=>document.getElementById(id),data=await picker.init();let selected=data.color,[h,s,v]=ColorMath.hsv(selected);
 function draw(){selected=ColorMath.rgb(h,s,v);$('hex').value=selected.toUpperCase();$('swatch').style.background=selected;$('hue').value=h;$('sv').style.backgroundColor=ColorMath.rgb(h,1,1);$('mark').style.left=s*100+'%';$('mark').style.top=(1-v)*100+'%';$('sv').setAttribute('aria-valuetext',selected);$('apply').disabled=false;$('error').textContent='';}
 function set(hex){[h,s,v]=ColorMath.hsv(hex);draw();}
 $('hue').oninput=()=>{h=Number($('hue').value);draw();};
 function point(e){const b=$('sv').getBoundingClientRect();s=Math.max(0,Math.min(1,(e.clientX-b.x)/b.width));v=1-Math.max(0,Math.min(1,(e.clientY-b.y)/b.height));draw();}
 $('sv').onpointerdown=e=>{if(e.button!==0)return;$('sv').setPointerCapture(e.pointerId);point(e);};$('sv').onpointermove=e=>{if($('sv').hasPointerCapture(e.pointerId))point(e);};
 $('sv').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();s=Math.max(0,Math.min(1,s+(e.key==='ArrowRight'?.01:e.key==='ArrowLeft'?-.01:0)));v=Math.max(0,Math.min(1,v+(e.key==='ArrowUp'?.01:e.key==='ArrowDown'?-.01:0)));draw();};
 $('hex').oninput=()=>{const value=$('hex').value;if(/^#[0-9a-f]{6}$/i.test(value))set(value);else{$('apply').disabled=true;$('error').textContent='请输入 #RRGGBB，例如 #26B4EB';}};
 $('screen').onclick=async()=>{const button=$('screen');button.disabled=true;try{const color=await picker.screen();if(color)set(color);}catch(e){$('error').textContent=e.message;}finally{button.disabled=false;}};
 $('cancel').onclick=()=>picker.confirm(null);$('apply').onclick=()=>picker.confirm(selected);draw();
})();
