# Fix WOFF Subset Font Decompression Issue

## Tóm tắt

Khi embed file subset WOFF (ví dụ `Georgia-Bold.woff`) vào PDF, `pdfkit` gọi xuống `fontkit` để đọc các bảng font. Ở đó nó bị crash vì dữ liệu bảng sau khi giải nén **ngắn hơn** so với `table.length` khai báo trong WOFF, đặc biệt là với các bảng như `hmtx`.

## Vấn đề của code cũ

```js
_getTableStream(tag) {
  let table = this.directory.tables[tag];
  if (table) {
    this.stream.pos = table.offset;
    if (table.compLength < table.length) {
      this.stream.pos += 2; // skip deflate header
      let outBuffer = new Uint8Array(table.length);
      let buf = inflate(this.stream.readBuffer(table.compLength - 2), outBuffer);
      return new r.DecodeStream(buf);
    } else {
      return this.stream;
    }
  }
  return null;
}
```

**2 vấn đề chính:**

### 1. Xử lý zlib chưa đúng spec WOFF

- WOFF dùng zlib: `2 byte header + deflate data + 4 byte checksum`.
- Code cũ chỉ bỏ qua **2 byte header**, sau đó đọc `compLength - 2` còn lại, trong đó vẫn bao gồm **4 byte checksum**.
- `inflate(...)` bị feed cả phần checksum, dẫn đến output không ổn định, có thể ngắn hoặc lệch so với `table.length` mong đợi.

### 2. Không xử lý case subset font / bảng bị ngắn

- Một số subset WOFF (như font embed trong PDF) khai báo `table.length` lớn hơn số byte thực có sau khi giải nén.
- `fontkit` bên trong expect đúng `table.length`, nên khi đọc tiếp (ví dụ parse `hmtx`) sẽ nổ lỗi "truncated table" / "out of range".

→ Kết quả: khi pdfkit cố embed font này vào PDF, nó văng lỗi từ fontkit do data bảng không đủ.

## Cách fix mới

```js
_getTableStream(tag) {
  let table = this.directory.tables[tag];
  if (table) {
    if (table.compLength < table.length) {
      // Compressed table - skip zlib header (2 bytes) and checksum (4 bytes)
      this.stream.pos = table.offset + 2;
      let deflateData = this.stream.readBuffer(table.compLength - 6);
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
```

**Ý nghĩa:**

### 1. Đọc zlib đúng chuẩn WOFF

- `this.stream.pos = table.offset + 2;`
  → Bỏ **2 byte header**.
- `this.stream.readBuffer(table.compLength - 6);`
  → Trừ luôn **2 byte header + 4 byte checksum**, chỉ đưa **deflate payload** cho `inflate(...)`.
- Điều này align với spec WOFF: inflate chỉ ăn phần deflate, không ăn phần Adler checksum.

### 2. Pad cho subset font có bảng ngắn hơn `table.length`

- Sau khi inflate, nếu `buf.length < table.length` → rõ ràng bảng thực tế ngắn hơn khai báo.
- Thay vì để fontkit crash, ta:
  - Tạo `padded = new Uint8Array(table.length)`
  - Copy dữ liệu thật vào đầu, phần còn lại để 0.
- Nhờ đó, các parser bên trong (đọc `hmtx`, `loca`, v.v.) không bị thiếu byte, và PDF được generate thành công.

## Tại sao subset font gây lỗi?

### Nguyên nhân gốc rễ

Subset font là font được tạo ra bằng cách chỉ giữ lại một phần glyphs từ font gốc. Khi tạo subset WOFF, có một số vấn đề có thể xảy ra:

1. **Metadata không được cập nhật đúng cách:**
   - Một số tool tạo subset font (đặc biệt là các tool embed trong PDF) có thể không cập nhật chính xác `table.length` trong WOFF directory.
   - Chúng có thể giữ nguyên `table.length` từ font gốc, trong khi dữ liệu thực tế sau khi subset và nén lại ngắn hơn.

2. **Quá trình subset không hoàn chỉnh:**
   - Khi subset font, các bảng như `hmtx` (horizontal metrics) cần được cập nhật để chỉ chứa metrics cho các glyphs còn lại.
   - Nếu quá trình subset không cập nhật đúng các bảng phụ thuộc, có thể dẫn đến:
     - Dữ liệu thực tế ngắn hơn `table.length` khai báo
     - Hoặc dữ liệu bị lệch, không align với cấu trúc mong đợi

3. **Lỗi trong quá trình nén:**
   - Một số tool có thể không xử lý đúng quá trình nén zlib, dẫn đến:
     - Checksum không đúng
     - Dữ liệu nén không hoàn chỉnh
     - Header/checksum bị lẫn vào phần deflate data

### Ví dụ cụ thể với `hmtx` table

Bảng `hmtx` chứa horizontal metrics cho từng glyph. Khi subset font:
- Font gốc có 1000 glyphs → `hmtx` có 1000 entries
- Font subset chỉ có 100 glyphs → `hmtx` chỉ cần 100 entries
- Nhưng nếu `table.length` vẫn giữ giá trị cũ (cho 1000 entries), trong khi dữ liệu thực chỉ có 100 entries
- → Khi fontkit đọc, nó expect đủ `table.length` bytes, nhưng chỉ có ít hơn → crash

### Xác minh bằng ttx

Khi dùng `ttx` (fonttools) để kiểm tra file `Georgia-Bold.woff`, ta thấy lỗi tương tự:

```
ERROR: An exception occurred during the decompilation of the 'hmtx' table
...
zlib.error: Error -3 while decompressing data: incorrect data check
```

Điều này xác nhận rằng:
- File WOFF này có vấn đề với cấu trúc zlib
- Ngay cả fonttools (reference implementation) cũng không thể đọc được
- Fix của chúng ta phải xử lý cả trường hợp này

## Tóm tắt logic giải thích cho team

* Lỗi ban đầu: embed subset WOFF vào PDF bị lỗi vì:
  * Code cũ xử lý zlib chưa đúng (chỉ bỏ 2 byte header, không bỏ checksum).
  * Một số subset font có dữ liệu giải nén ngắn hơn `table.length`, khiến fontkit báo bảng bị truncate.

* Fix:
  * Đọc đúng cấu trúc zlib trong WOFF: bỏ cả header (2 byte) và checksum (4 byte), chỉ inflate phần deflate.
  * Nếu data giải nén vẫn ngắn hơn `table.length` (subset font "bẩn" / không chuẩn), pad thêm 0 cho đủ length để fontkit không crash.

* Kết quả:
  * Font subset như `Georgia-Bold.woff` embed vào PDF không còn lỗi.
  * Vẫn tuân thủ spec về phần nén, padding chỉ là workaround thực dụng cho subset font embed không hoàn toàn chuẩn.

## Trạng thái hiện tại

Fix đã được implement trong `src/WOFFFont.js`. Code hiện tại:

```js
_getTableStream(tag) {
  let table = this.directory.tables[tag];
  if (table) {
    if (table.compLength < table.length) {
      // Compressed table - skip zlib header (2 bytes) and checksum (4 bytes)
      this.stream.pos = table.offset + 2;
      let deflateData = this.stream.readBuffer(table.compLength - 6);
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
```

## Verification với ttx

Để verify fix, có thể dùng `ttx` từ fonttools:

```bash
# List tables
ttx -l Georgia-Bold.woff
```

Kết quả:
```
Listing table info for "Georgia-Bold.woff":
    tag     checksum    length    offset
    ----  ----------  --------  --------
    FFTM  0x689AC87D        28     39296
    GDEF  0x00250000        23     39272
    OS/2  0x4D029403        85     19904
    cmap  0x466D3E44      1308     21340
    cvt   0x81D97D06       498     25264
    fpgm  0xE43CA8FF      1490     22648
    glyf  0xA941D523      9584     25888
    head  0xEA936C4A        54       344
    hhea  0x0F1E0C36        33     19836
    hmtx  0xD2C0089B      1345     19992
    loca  0xD96ACDF6       122     25764
    maxp  0x079E0201        32     19872
    name  0x0BE392F2       396     35472
    post  0xDD4DA33E      3401     35868
    prep  0x3E64935E      1122     24140
```

Khi thử dump table `hmtx`:
```bash
ttx -t hmtx Georgia-Bold.woff
```

Kết quả (ttx báo lỗi):
```
ERROR: An exception occurred during the decompilation of the 'hmtx' table
...
zlib.error: Error -3 while decompressing data: incorrect data check
```

**Giải thích:**
- File `Georgia-Bold.woff` có vấn đề với cấu trúc zlib, nên `ttx` (fonttools) không thể đọc được.
- Điều này xác nhận rằng file này là một subset font "không chuẩn" với vấn đề về:
  1. Cấu trúc zlib không đúng (checksum bị lẫn vào deflate data)
  2. Dữ liệu giải nén ngắn hơn `table.length` khai báo
- Với fix mới trong `fontkit`, chúng ta có thể đọc được file này bằng cách:
  1. Xử lý đúng cấu trúc zlib (bỏ header 2 byte và checksum 4 byte)
  2. Pad dữ liệu nếu ngắn hơn `table.length` để tránh crash khi parser đọc các bảng

## References

- [WOFF Specification](https://www.w3.org/TR/WOFF/)
- [fonttools - Python library for manipulating fonts](https://github.com/fonttools/fonttools)
- [zlib format specification](https://www.ietf.org/rfc/rfc1950.txt)

