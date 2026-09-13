import { analyzeSharedOutputs } from '@fingerpoint/shared/shared-detector'
self.onmessage = ({data}) => {
  try {
    const result = analyzeSharedOutputs(data.outputs,data.bank,data.detector)
    self.postMessage({result})
  } catch(error) {self.postMessage({error:error instanceof Error ? error.message:'计算失败'})}
}
