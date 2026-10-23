// Whole-book rules and heat map for one pair, off the main thread.
import { classifier, scanPair } from './engine.js'

self.onmessage = (event) => {
  const { rows, lemmas, functionWords } = event.data
  self.postMessage(scanPair(rows, classifier({ lemmas, functionWords })))
}
