// Stockfish's ASM.JS build keeps the engine entirely in JavaScript, so it
// works in Expo Go without a custom native module or a development build.
import stockfishFactory from 'stockfish/bin/stockfish-18-asm.js';

export type StockfishEngine = {
  processCommand: (command: string) => void;
  terminate?: () => void;
};

type RawStockfishEngine = {
  ccall: (
    name: string,
    returnType: null,
    argumentTypes: string[],
    argumentsList: string[],
    options?: { async?: boolean },
  ) => void | Promise<void>;
  terminate?: () => void;
};

type EngineOptions = {
  listener: (line: string) => void;
  noInitialRun?: boolean;
};

type EngineFactory = () => (options: EngineOptions) => Promise<StockfishEngine>;

export async function createStockfishEngine(
  onLine: (line: string) => void,
): Promise<StockfishEngine> {
  const createEngine = (stockfishFactory as unknown as EngineFactory)();
  const rawEngine = (await createEngine({
    listener: onLine,
  })) as unknown as RawStockfishEngine;

  return {
    terminate: rawEngine.terminate,
    processCommand: (command) => {
      // Stockfish's raw ASM.JS module must finish its initial run before it
      // accepts UCI commands. Scheduling each command also preserves the
      // order of `uci`, `isready`, `position`, and `go` across platforms.
      setTimeout(() => {
        void rawEngine.ccall('command', null, ['string'], [command], {
          async: /^go\b/.test(command),
        });
      }, 0);
    },
  };
}