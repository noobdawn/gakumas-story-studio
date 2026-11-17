(async()=>{
 const {image}=await picker.init(),img=document.getElementById('desktop'),lens=document.getElementById('lens'),canvas=lens.querySelector('canvas'),ctx=canvas.getContext('2d'),source=document.createElement('canvas');
 img.src=image;await img.decode();source.width=img.naturalWidth;source.height=img.naturalHeight;const original=source.getContext('2d',{willReadFrequently:true});original.drawImage(img,0,0);let ready=true;
 function update(e){const x=Math.max(0,Math.min(source.width-1,Math.floor(e.clientX/innerWidth*source.width))),y=Math.max(0,Math.min(source.height-1,Math.floor(e.clientY/innerHeight*source.height)));ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,99,99);ctx.drawImage(source,x-5,y-5,11,11,0,0,99,99);ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(45.5,45.5,8,8);ctx.strokeStyle='#000';ctx.strokeRect(44.5,44.5,10,10);const p=original.getImageData(x,y,1,1).data;document.getElementById('hex').textContent='#'+[...p].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();lens.hidden=false;lens.style.left=Math.max(0,Math.min(innerWidth-118,e.clientX+22))+'px';lens.style.top=Math.max(0,Math.min(innerHeight-145,e.clientY+22))+'px';}
 document.onpointermove=update;document.onpointerleave=()=>lens.hidden=true;
 document.onclick=e=>{if(!ready||e.button!==0)return;ready=false;picker.sample(Math.max(0,Math.min(.999999,e.clientX/innerWidth)),Math.max(0,Math.min(.999999,e.clientY/innerHeight)));};
 document.oncontextmenu=e=>{e.preventDefault();picker.cancelScreen();};document.onkeydown=e=>{if(e.key==='Escape')picker.cancelScreen();};
})();
