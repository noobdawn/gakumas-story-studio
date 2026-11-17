// Use a separate native window; Chromium's built-in eyedropper is clipped by the embedded Player.
(()=>{
 let busy=false;
 document.addEventListener('click',async event=>{
  const input=event.target.closest?.('input[type=color]');if(!input||input.disabled||!window.colorAPI)return;
  event.preventDefault();if(busy)return;busy=true;const previous=input.value;
  try{const value=await window.colorAPI.pick(previous);if(value&&input.isConnected&&!input.disabled&&input.value===previous&&/^#[0-9a-f]{6}$/i.test(value)&&value.toLowerCase()!==previous.toLowerCase()){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}}
  catch(error){window.dispatchEvent(new CustomEvent('creator-color-error',{detail:error.message}));}finally{busy=false;}
 },true);
})();
