const r=n=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
document.getElementById('s').textContent=r(36);document.getElementById('m').textContent=r(24);
document.addEventListener('click',e=>{const b=e.target.closest('[data-c]');if(!b)return;navigator.clipboard.writeText(document.getElementById(b.dataset.c).textContent).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)})});
