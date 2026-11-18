import { descargarCsv } from './csv';

const BOM = '﻿';

/** Lee el contenido de un Blob (jsdom no siempre trae Blob.text()). */
function leer(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(lector.error);
    lector.readAsText(blob);
  });
}

/** Lee los bytes crudos de un Blob (el texto decodificado descarta el BOM). */
function leerBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result as ArrayBuffer);
    lector.onerror = () => reject(lector.error);
    lector.readAsArrayBuffer(blob);
  });
}

describe('descargarCsv', () => {
  let blobGenerado: Blob | undefined;
  let nombreDescargado: string | undefined;

  beforeEach(() => {
    blobGenerado = undefined;
    nombreDescargado = undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobGenerado = blob;
      return 'blob:prueba';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      nombreDescargado = this.download;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('descarga el archivo con el nombre indicado y libera la URL temporal', () => {
    descargarCsv('zonas.csv', [['a']]);
    expect(nombreDescargado).toBe('zonas.csv');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:prueba');
  });

  it('usa ";" como separador, salto de línea de Windows y tipo CSV', async () => {
    descargarCsv('datos.csv', [['zona', 'predios'], ['Ica', 12]]);
    const texto = await leer(blobGenerado as Blob);
    expect(texto.replace(BOM, '')).toBe('zona;predios\r\nIca;12');
    expect((blobGenerado as Blob).type).toBe('text/csv;charset=utf-8');
  });

  it('agrega el BOM UTF-8 para que Excel respete las tildes', async () => {
    descargarCsv('datos.csv', [['Ancash']]);
    const bytes = new Uint8Array(await leerBytes(blobGenerado as Blob));
    // El BOM UTF-8 son los bytes EF BB BF al inicio del archivo.
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('escribe los decimales con coma', async () => {
    descargarCsv('datos.csv', [[1891.2]]);
    const texto = await leer(blobGenerado as Blob);
    expect(texto.replace(BOM, '')).toBe('1891,2');
  });

  it('deja vacías las celdas nulas e indefinidas', async () => {
    descargarCsv('datos.csv', [['a', null, undefined, 'b']]);
    const texto = await leer(blobGenerado as Blob);
    expect(texto.replace(BOM, '')).toBe('a;;;b');
  });

  it('entrecomilla las celdas con ";", comillas o saltos de línea', async () => {
    descargarCsv('datos.csv', [['a;b', 'dijo "hola"', 'línea1\nlínea2']]);
    const texto = await leer(blobGenerado as Blob);
    expect(texto.replace(BOM, '')).toBe('"a;b";"dijo ""hola""";"línea1\nlínea2"');
  });
});
