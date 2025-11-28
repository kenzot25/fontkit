import TTFFont from './TTFFont';
import WOFFDirectory from './tables/WOFFDirectory';
import tables from './tables';
import inflate from 'tiny-inflate';
import * as r from 'restructure';
import { asciiDecoder } from './utils';

export default class WOFFFont extends TTFFont {
  type = 'WOFF';

  static probe(buffer) {
    return asciiDecoder.decode(buffer.slice(0, 4)) === 'wOFF';
  }

  _decodeDirectory() {
    this.directory = WOFFDirectory.decode(this.stream, { _startOffset: 0 });
  }

  _getTableStream(tag) {
    let table = this.directory.tables[tag];
    if (table) {
      if (table.compLength < table.length) {
        // Compressed table - zlib format includes a 2-byte header
        // The checksum is stored separately in the directory entry, not in the compressed data
        this.stream.pos = table.offset + 2; // Skip zlib header (2 bytes)
        let deflateData = this.stream.readBuffer(table.compLength - 2); // Read deflate data
        let outBuffer = new Uint8Array(table.length);
        let buf = inflate(deflateData, outBuffer);
        
        // Pad if inflated data is shorter than expected
        if (buf.length < table.length) {
          let padded = new Uint8Array(table.length);
          padded.set(buf, 0);
          return new r.DecodeStream(padded);
        }
        
        return new r.DecodeStream(buf);
      } else {
        // Uncompressed table
        this.stream.pos = table.offset;
        return this.stream;
      }
    }

    return null;
  }
}
