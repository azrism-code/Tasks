import {mkdir,writeFile} from 'node:fs/promises';
const sampleRate=22050;
const tones={gentle:[[660,.22,.20],[880,.30,.16]],normal:[[784,.25,.45],[1046,.35,.4]],loud:[[880,.3,.85],[1175,.3,.8],[880,.35,.85]],bell:[[1046,1.2,.55]],alarm:[[880,.22,.8],[660,.22,.8],[880,.22,.8],[660,.22,.8],[880,.22,.8]]};
await mkdir('sounds',{recursive:true});
for(const [name,notes] of Object.entries(tones)){
  const length=Math.ceil(notes.reduce((n,[,seconds])=>n+seconds+.06,0)*sampleRate);
  const buffer=Buffer.alloc(44+length*2);
  buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(sampleRate,24);buffer.writeUInt32LE(sampleRate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(length*2,40);
  let offset=0;
  for(const [frequency,seconds,volume] of notes){
    const count=Math.floor(seconds*sampleRate);
    for(let i=0;i<count;i++){
      const time=i/sampleRate,fade=Math.min(1,time/.015,(seconds-time)/.04);
      const bell=name==='bell'?(Math.sin(2*Math.PI*frequency*time)+.35*Math.sin(2*Math.PI*frequency*2.76*time))/1.35:Math.sin(2*Math.PI*frequency*time);
      const envelope=name==='bell'?Math.exp(-time*3):1;
      buffer.writeInt16LE(Math.round(32767*volume*bell*fade*envelope),44+(offset+i)*2);
    }
    offset+=count+Math.floor(.06*sampleRate);
  }
  await writeFile(`sounds/tasks_${name}.wav`,buffer);
}
