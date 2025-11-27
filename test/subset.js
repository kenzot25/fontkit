import * as fontkit from 'fontkit';
import assert from 'assert';
import concat from 'concat-stream';
import * as r from 'restructure';
import fs from 'fs';

describe('font subsetting', function () {
  describe('truetype subsetting', function () {
    let font = fontkit.openSync(new URL('data/OpenSans/OpenSans-Regular.ttf', import.meta.url));

    it('should produce a subset', function () {
      let subset = font.createSubset();
      for (let glyph of font.glyphsForString('hello')) {
        subset.includeGlyph(glyph);
      }

      let buf = subset.encode();
      let f = fontkit.create(buf);
      assert.equal(f.numGlyphs, 5);
      assert.equal(f.getGlyph(1).path.toSVG(), font.glyphsForString('h')[0].path.toSVG());
    });

    it('should re-encode variation glyphs', function () {
      if (!fs.existsSync('/Library/Fonts/Skia.ttf')) return this.skip();

      let font = fontkit.openSync('/Library/Fonts/Skia.ttf', 'Bold');
      let subset = font.createSubset();
      for (let glyph of font.glyphsForString('e')) {
        subset.includeGlyph(glyph);
      }

      let buf = subset.encode();
      let f = fontkit.create(buf);
      assert.equal(f.getGlyph(1).path.toSVG(), font.glyphsForString('e')[0].path.toSVG());
    });

    it('should handle composite glyphs', function () {
      let subset = font.createSubset();
      subset.includeGlyph(font.glyphsForString('é')[0]);

      let buf = subset.encode();
      let f = fontkit.create(buf);
      assert.equal(f.numGlyphs, 4);
      assert.equal(f.getGlyph(1).path.toSVG(), font.glyphsForString('é')[0].path.toSVG());
    });

    it('should handle fonts with long index to location format (indexToLocFormat = 1)', function () {
      let font = fontkit.openSync(new URL('data/FiraSans/FiraSans-Regular.ttf', import.meta.url));
      let subset = font.createSubset();
      for (let glyph of font.glyphsForString('abcd')) {
        subset.includeGlyph(glyph);
      }

      let buf = subset.encode();
      let f = fontkit.create(buf);
      assert.equal(f.numGlyphs, 5);
      assert.equal(f.getGlyph(1).path.toSVG(), font.glyphsForString('a')[0].path.toSVG());
      // must test also second glyph which has an odd loca index
      assert.equal(f.getGlyph(2).path.toSVG(), font.glyphsForString('b')[0].path.toSVG());
    });
  });

  describe('CFF subsetting', function () {
    let font = fontkit.openSync(new URL('data/SourceSansPro/SourceSansPro-Regular.otf', import.meta.url));

    it('should produce a subset', function () {
      let subset = font.createSubset();
      let iterable = font.glyphsForString('hello');
      for (let i = 0; i < iterable.length; i++) {
        let glyph = iterable[i];
        subset.includeGlyph(glyph);
      }

      let buf = subset.encode();
      let stream = new r.DecodeStream(buf);
      let CFFFont = font._tables['CFF '].constructor;
      let CFFGlyph = iterable[0].constructor;
      let cff = new CFFFont(stream);
      let glyph = new CFFGlyph(1, [], { stream, 'CFF ': cff });
      assert.equal(glyph.path.toSVG(), font.glyphsForString('h')[0].path.toSVG());
    });

    it('should handle CID fonts', function () {
      let f = fontkit.openSync(new URL('data/NotoSansCJK/NotoSansCJKkr-Regular.otf', import.meta.url));
      let subset = f.createSubset();
      let iterable = f.glyphsForString('갈휸');
      for (let i = 0; i < iterable.length; i++) {
        let glyph = iterable[i];
        subset.includeGlyph(glyph);
      }

      let buf = subset.encode();
      let stream = new r.DecodeStream(buf);
      let CFFFont = font._tables['CFF '].constructor;
      let CFFGlyph = iterable[0].constructor;
      let cff = new CFFFont(stream);
      let glyph = new CFFGlyph(1, [], { stream, 'CFF ': cff });
      assert.equal(glyph.path.toSVG(), f.glyphsForString('갈')[0].path.toSVG());
      assert.equal(cff.topDict.FDArray.length, 2);
      assert.deepEqual(cff.topDict.FDSelect.fds, [0, 1, 1]);
    });

    it('should produce a subset with asian punctuation corretly', function () {
      const koreanFont = fontkit.openSync(new URL('data/NotoSansCJK/NotoSansCJKkr-Regular.otf', import.meta.url));
      const subset = koreanFont.createSubset();
      const iterable = koreanFont.glyphsForString('a。d');
      for (let i = 0; i < iterable.length; i++) {
        const glyph = iterable[i];
        subset.includeGlyph(glyph);
      }

      let buf = subset.encode();
      const stream = new r.DecodeStream(buf);
      let CFFFont = font._tables['CFF '].constructor;
      let CFFGlyph = iterable[0].constructor;
      const cff = new CFFFont(stream);
      let glyph = new CFFGlyph(1, [], { stream, 'CFF ': cff });
      assert.equal(glyph.path.toSVG(), koreanFont.glyphsForString('a')[0].path.toSVG());
      glyph = new CFFGlyph(2, [], { stream, 'CFF ': cff });
      assert.equal(glyph.path.toSVG(), koreanFont.glyphsForString('。')[0].path.toSVG());
      glyph = new CFFGlyph(3, [], { stream, 'CFF ': cff });
      assert.equal(glyph.path.toSVG(), koreanFont.glyphsForString('d')[0].path.toSVG());
    });
  });

  describe('custom font subsetting', function () {
    // Test any font by setting FONT_PATH environment variable
    // Example: FONT_PATH=/path/to/font.woff npm test -- test/subset.js
    const fontPath = process.env.FONT_PATH;
    
    if (!fontPath || !fs.existsSync(fontPath)) {
      it.skip('should test custom font (set FONT_PATH env var to test)', function () {});
      return;
    }

    let font;
    before(function () {
      try {
        font = fontkit.openSync(fontPath);
      } catch (e) {
        this.skip();
      }
    });

    it('should open the custom font', function () {
      assert(font, 'Font should be loaded');
      assert(font.type, 'Font should have a type');
      console.log(`Testing font: ${fontPath}`);
      console.log(`Font type: ${font.type}`);
      console.log(`Font name: ${font.postscriptName || 'N/A'}`);
      console.log(`Number of glyphs: ${font.numGlyphs}`);
    });

    it('should create a subset from the custom font', function () {
      // Debug: Check if hmtx table is accessible
      console.log('Checking font tables...');
      console.log('Directory tables:', Object.keys(font.directory.tables));
      
      // Try to manually decode hhea to see what happens
      try {
        let hheaTable = font.directory.tables['hhea'];
        if (hheaTable) {
          console.log('Attempting to decode hhea manually...');
          let hheaStream = font._getTableStream('hhea');
          if (hheaStream) {
            console.log('hhea stream available, pos:', hheaStream.pos);
            // Try to decode it
            let hhea = font._decodeTable(hheaTable);
            console.log('hhea decoded successfully:', !!hhea);
            if (hhea) {
              console.log('hhea.numberOfMetrics:', hhea.numberOfMetrics);
            }
          } else {
            console.log('hhea stream is null');
          }
        }
      } catch (e) {
        console.log('Error manually decoding hhea:', e.message);
        console.log('Error stack:', e.stack);
      }
      
      // Try to force load hhea first (hmtx depends on it)
      try {
        let hhea = font.hhea;
        console.log('hhea loaded via property:', !!hhea);
        if (hhea) {
          console.log('hhea.numberOfMetrics:', hhea.numberOfMetrics);
        }
      } catch (e) {
        console.log('Error loading hhea via property:', e.message);
      }
      
      // Try to force load hmtx
      try {
        let hmtx = font.hmtx;
        console.log('hmtx loaded:', !!hmtx);
        if (hmtx) {
          console.log('hmtx.metrics length:', hmtx.metrics ? hmtx.metrics.length : 'undefined');
        }
      } catch (e) {
        console.log('Error loading hmtx:', e.message);
      }
      
      let subset = font.createSubset();
      
      // Include glyphs for "hello" if available
      try {
        let testString = 'hello';
        let glyphs = font.glyphsForString(testString);
        console.log(`Found ${glyphs.length} glyphs for "${testString}"`);
        
        // Try to access advanceWidth before including in subset
        for (let i = 0; i < glyphs.length; i++) {
          let glyph = glyphs[i];
          try {
            console.log(`Glyph ${i} (id: ${glyph.id}): advanceWidth = ${glyph.advanceWidth}`);
          } catch (e) {
            console.log(`Error accessing glyph ${i} advanceWidth:`, e.message);
          }
        }
        
        for (let glyph of glyphs) {
          subset.includeGlyph(glyph);
        }
      } catch (e) {
        console.log('Error with "hello" string, trying first few glyphs:', e.message);
        // If "hello" doesn't work, try including first few glyphs
        for (let i = 0; i < Math.min(5, font.numGlyphs); i++) {
          try {
            let glyph = font.getGlyph(i);
            console.log(`Trying glyph ${i}, advanceWidth = ${glyph.advanceWidth}`);
            subset.includeGlyph(i);
          } catch (e2) {
            console.log(`Error with glyph ${i}:`, e2.message);
            throw e2;
          }
        }
      }

      let buf = subset.encode();
      let f = fontkit.create(buf);
      assert(f, 'Subset font should be created');
      assert(f.numGlyphs > 0, 'Subset should have glyphs');
      console.log(`Subset created with ${f.numGlyphs} glyphs`);
    });

    it('should handle WOFF font subsetting if applicable', function () {
      if (font.type !== 'WOFF' && font.type !== 'WOFF2') {
        this.skip();
      }

      let subset = font.createSubset();
      let testString = 'test';
      try {
        let glyphs = font.glyphsForString(testString);
        for (let glyph of glyphs) {
          subset.includeGlyph(glyph);
        }
      } catch (e) {
        // Fallback to first few glyphs
        for (let i = 0; i < Math.min(5, font.numGlyphs); i++) {
          subset.includeGlyph(i);
        }
      }

      let buf = subset.encode();
      // Subset should encode as TTF, not WOFF
      let f = fontkit.create(buf);
      assert.equal(f.type, 'TTF');
      console.log(`WOFF subset test passed - output type: ${f.type}`);
    });
  });
});
