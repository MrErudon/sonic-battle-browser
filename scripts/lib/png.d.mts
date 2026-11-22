export interface RgbaImage {width:number;height:number;rgba:Uint8Array}
export function decodePng(input:Uint8Array):RgbaImage;
export function encodePng(image:RgbaImage):Uint8Array;
