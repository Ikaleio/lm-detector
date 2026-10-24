import { parentPort, workerData } from 'node:worker_threads'
import { retrain } from '../offline/retrain'

const { directory } = workerData as { directory: string }
const result = await retrain(directory, message => parentPort?.postMessage({ progress: message }))
parentPort?.postMessage({ result })
