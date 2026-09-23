import { env, RawImage, SamModel, AutoProcessor, Tensor } from '@huggingface/transformers';
import type { SamProcessor } from '@huggingface/transformers';

// A maintained public image-segmentation model; all video pixels remain local.
env.allowLocalModels=false;
env.backends.onnx.wasm!.numThreads=1;
env.backends.onnx.wasm!.proxy=false;
let loaded:Promise<{model:SamModel;processor:SamProcessor}>|undefined;
let frameKey:string|undefined, embeddings:Record<string,Tensor>|undefined;
function load() {
  return loaded??=(async()=>{
    const id='Xenova/slimsam-77-uniform';
    const model=await SamModel.from_pretrained(id,{dtype:'fp32',device:'wasm',progress_callback:()=>self.postMessage({status:'Loading selection model…'})}) as SamModel;
    const processor=await AutoProcessor.from_pretrained(id) as SamProcessor;
    return {model,processor};
  })();
}
self.onmessage=async({data}:{data:{pixels:ImageData;frameKey:string;points:{x:number;y:number;label:0|1}[]}})=>{
  const owned=new Set<Tensor>();
  const retain=(value:unknown):void=>{
    if(value instanceof Tensor)owned.add(value);
    else if(value&&typeof value==='object')Object.values(value).forEach(retain);
  };
  try {
    const {model,processor}=await load();
    self.postMessage({status:'Selecting object…'});
    const {pixels,points}=data;
    const image=new RawImage(pixels.data,pixels.width,pixels.height,4);
    const inputs=await processor(image,{input_points:[points.map(p=>[p.x*pixels.width,p.y*pixels.height])],input_labels:[points.map(p=>p.label)]});retain(inputs);
    if(frameKey!==data.frameKey||!embeddings) {
      if(embeddings)Object.values(embeddings).forEach(t=>t.dispose());
      embeddings=await model.get_image_embeddings({pixel_values:inputs.pixel_values});frameKey=data.frameKey;
    }
    const output=await model({...inputs,...embeddings});retain(output);
    const masks=await processor.post_process_masks(output.pred_masks,inputs.original_sizes,inputs.reshaped_input_sizes);retain(masks);
    const scores=Array.from(output.iou_scores.data,Number);
    let best=0;for(let i=1;i<scores.length;i++)if(scores[i]>scores[best])best=i;
    const tensor=masks[0],size=pixels.width*pixels.height;
    const mask=Uint8Array.from(tensor.data.slice(best*size,(best+1)*size),v=>Number(v)?255:0);
    self.postMessage({mask,width:pixels.width,height:pixels.height}, {transfer:[mask.buffer]});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
  finally{for(const tensor of owned)tensor.dispose();}
};
