declare module "compressjs" {
  interface Bzip2Codec {
    compressFile(input: Uint8Array): number[];
  }

  export const Bzip2: Bzip2Codec;

  const compressjs: {
    Bzip2: Bzip2Codec;
  };
  export default compressjs;
}
