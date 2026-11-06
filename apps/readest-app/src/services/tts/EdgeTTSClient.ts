import { EDGE_TTS_PROTOCOL } from '@/libs/edgeTTS';
import { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { createBookTTSCacheStore } from './providers/bookCacheStore';
import { CachingProvider, type TTSCacheStore } from './providers/cache';
import { EdgeSpeechProvider } from './providers/edge';
import { SpeechProvider } from './providers/types';
import { TTSController } from './TTSController';

// Everything engine-independent (scheduler, playout, word tracking, preload)
// lives in BufferedTTSClient; the Edge specifics live in EdgeSpeechProvider.
export { DEFAULT_SENTENCE_GAP_SEC } from './BufferedTTSClient';

export class EdgeTTSClient extends BufferedTTSClient {
  #edgeProvider: EdgeSpeechProvider;

  // `store` is the controller's shared per-book cache store (null: caching
  // off). Omitted, the client builds its own (standalone use and tests).
  constructor(
    controller?: TTSController,
    appService?: AppService | null,
    store?: TTSCacheStore | null,
  ) {
    const edgeProvider = new EdgeSpeechProvider();
    let provider: SpeechProvider = edgeProvider;
    const cacheStore =
      store === undefined
        ? createBookTTSCacheStore(appService, () => controller?.bookKey?.split('-')[0] || null)
        : store;
    if (cacheStore) {
      provider = new CachingProvider(edgeProvider, cacheStore);
    }
    super(provider, controller, appService);
    this.#edgeProvider = edgeProvider;
  }

  override async init(_protocol: EDGE_TTS_PROTOCOL = 'wss'): Promise<boolean> {
    this.voices = await this.#edgeProvider.getAllVoices();
    if (await this.#edgeProvider.init('wss')) {
      this.initialized = true;
      return true;
    }
    if (this.provider instanceof CachingProvider) {
      this.initialized = true;
      return true;
    }
    this.initialized = false;
    return false;
  }
}
