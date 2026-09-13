// =============================================================================
// NIL Office — Cheque amount-to-words tests.
// Pure-function tests for lib/cheque/amountToWords.ts. Deterministic,
// no DB/network dependency — actually runnable in any sandbox.
//
// Run:  node --experimental-strip-types supabase/tests/cheque-amount-to-words.test.mjs
// =============================================================================
import { numberToPersianWords, amountToPersianWords } from '../../lib/cheque/amountToWords.ts';

let failures = 0;
function check(name, cond) {
  if (cond) console.log('PASS:', name);
  else { failures++; console.error('FAIL:', name); }
}

// --- numberToPersianWords -----------------------------------------------
check('zero', numberToPersianWords(0) === 'صفر');
check('single digit', numberToPersianWords(7) === 'هفت');
check('teen', numberToPersianWords(14) === 'چهارده');
check('two-digit compound', numberToPersianWords(23) === 'بیست و سه');
check('round ten', numberToPersianWords(30) === 'سی');
check('three-digit compound', numberToPersianWords(350) === 'سیصد و پنجاه');
check('round hundred', numberToPersianWords(200) === 'دویست');
check('exactly one thousand', numberToPersianWords(1000) === 'یک هزار');
check('thousands compound', numberToPersianWords(12345) === 'دوازده هزار و سیصد و چهل و پنج');
check('spec example: 350,000,000', numberToPersianWords(350_000_000) === 'سیصد و پنجاه میلیون');
check('one billion (میلیارد)', numberToPersianWords(1_000_000_000) === 'یک میلیارد');
check('mixed large number', numberToPersianWords(1_204_050) === 'یک میلیون و دویست و چهار هزار و پنجاه');

let threw = false;
try { numberToPersianWords(-5); } catch { threw = true; }
check('negative rejected', threw);

threw = false;
try { numberToPersianWords(1.5); } catch { threw = true; }
check('non-integer rejected', threw);

// --- amountToPersianWords (cheque-specific, currency-aware) --------------
check(
  "spec's own example: 350,000,000 Toman",
  amountToPersianWords(350_000_000, 'TOMAN') === 'سیصد و پنجاه میلیون تومان',
);
check('IRR suffix', amountToPersianWords(1000, 'IRR') === 'یک هزار ریال');
check('Toman vs Rial suffix differ', amountToPersianWords(1000, 'TOMAN') !== amountToPersianWords(1000, 'IRR'));
check('unknown currency falls back to the raw code', amountToPersianWords(10, 'XYZ') === 'ده XYZ');

threw = false;
try { amountToPersianWords(0, 'TOMAN'); } catch { threw = true; }
check('zero amount rejected', threw);

threw = false;
try { amountToPersianWords(-1000, 'TOMAN'); } catch { threw = true; }
check('negative amount rejected', threw);

threw = false;
try { amountToPersianWords(100.5, 'TOMAN'); } catch { threw = true; }
check('fractional amount rejected', threw);

console.log(failures === 0 ? '\nAll cheque amount-to-words tests passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
