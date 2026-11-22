import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
describe('responsive layout rules', () => {
    it('reflows the map and province details at tablet and mobile widths', () => {
        expect(styles).toContain('@media(max-width:1150px)');
        expect(styles).toContain('@media(max-width:900px){main{padding:14px}.workspace{display:flex;flex-direction:column');
        expect(styles).toContain('@media(max-width:600px)');
        expect(styles).toContain('.toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto');
    });
});
