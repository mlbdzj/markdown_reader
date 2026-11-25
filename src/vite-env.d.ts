/// <reference types="vite/client" />

interface MdReaderBridge {
  getPathForFile: (file: File) => string;
}

interface Window {
  mdReader?: MdReaderBridge;
}
