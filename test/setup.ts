/**
 * The suite reads like the Russian screen: Russian is the source language and
 * the key of every `t()`. English is the default for people; that default is
 * checked in test/i18n.test.ts by a CLI run in a clean environment.
 */
import { setLang } from '../src/i18n/i18n.js';
import { DEFAULTS } from '../src/settings.js';

DEFAULTS.lang = 'ru';
setLang('ru');
