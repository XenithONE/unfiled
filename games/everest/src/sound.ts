export class Sound {
  ctx?:AudioContext; gain?:GainNode; wind?:GainNode; enabled=true; next=0;
  start(){
    if(!this.ctx){const ctx=this.ctx=new AudioContext();this.gain=ctx.createGain();this.gain.gain.value=.24;this.gain.connect(ctx.destination);
      const b=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*.5;
      const src=ctx.createBufferSource();src.buffer=b;src.loop=true;const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=700;
      this.wind=ctx.createGain();this.wind.gain.value=0;src.connect(filter);filter.connect(this.wind);this.wind.connect(this.gain);src.start();}
    void this.ctx.resume();
  }
  toggle(){this.enabled=!this.enabled;if(this.gain)this.gain.gain.setTargetAtTime(this.enabled?.24:0,this.ctx!.currentTime,.1);return this.enabled;}
  update(speed:number,playing:boolean){if(this.ctx&&this.wind)this.wind.gain.setTargetAtTime(playing?speed*.012:0,this.ctx.currentTime,.3);}
  chime(kind='trick'){if(!this.ctx||!this.gain||!this.enabled)return;const t=this.ctx.currentTime;if(t<this.next)return;this.next=t+.18;
    (kind==='finish'?[523,659,784,1046]:[659,880]).forEach((freq,i)=>{const o=this.ctx!.createOscillator(),g=this.ctx!.createGain();o.type='sine';o.frequency.value=freq;o.connect(g);g.connect(this.gain!);g.gain.setValueAtTime(0,t+i*.09);g.gain.linearRampToValueAtTime(.15,t+i*.09+.015);g.gain.exponentialRampToValueAtTime(.001,t+i*.09+.4);o.start(t+i*.09);o.stop(t+i*.09+.45);});}
}
