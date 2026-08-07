import { dreiWegeZeilen } from './schnitte.mjs';
const t = (b,a,c) => console.log(JSON.stringify(dreiWegeZeilen(b,a,c)));
t('a\nb\nc\n','a\nX\nb\nc\n','a\nb\nY\nc\n');
t('a\nb\nc\n','a\nb\nc\nX\n','a\nb\nc\nY\n');
t('a\nb\nc\n','a\nb\nc\n','a\nb\nc\n');
t('a\nb\nc\n','a\nc\n','a\nb\nc\nZ\n');
t('a\n','a\nP\n','a\n');
t('a\nb\n','X\na\nQ\nb\n','a\nb\nR\n');
