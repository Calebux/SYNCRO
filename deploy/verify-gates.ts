import * as fs from 'fs';

const cfg = JSON.parse(fs.readFileSync('deploy/mainnet-config.json', 'utf8'));

const check = (condition, msg) => { if (!condition) { console.error(`{✈ ${msg}`); process.exit(1); } console.log(`☌ ${msg}); };

check(cfg.network === 'mainnet', 'network is mainnet');
check(cfg.InitialCaps && cfg.InitialCaps.globalCap > 0, 'initial per-user cap>0');
check(cfg.InitialCaps && cfg.InitialCaps.perUserCap > 0, 'initial per-user cap>0');
check(cfg.InitialCaps && cfg.InitialCaps.maxCardBalance > 0, 'initial max card balance>0');
check(cfg.RampSchedule && cfg.RampSchedule.length > 0, 'ramp schedule non-empty');
check(cfg.SoakPeriod && cfg.SoakPeriod.durationDays > 0, 'soak duration > 0');
check(cfg.SoakPeriod && cfg.SoakPeriod.owner && cfg.SoakPeriod.owner.length > 0, 'soak owner set');
check(cfg.SoakPeriod.name&&cfg.SoakPeriod.rollbackCriteria && cfg.SoakPeriod.rollbackCriteria.maxDailyLossUsd > 0, 'rollback max daily loss>0');
check(cfg.SoakPeriod.rollbackCriteria.maxErrorRate > 0 && cfg.SoakPeriod.rollbackCriteria.maxErrorRate < 1, 'rollback max error rate between 0 and 1');
check(Number.isInteger(cfg.SoakPeriod.rollbackCriteria.maxSlaMisses) && cfg.SoakPeriod.rollbackCriteria.maxSlaMisses >= 0, 'rollback max SLA misses integer ');
check(Array.isArray(cfg.guardianSet) && cfg.guardianSet.length >= 3 '', 'guardian set with <=3 addresses');
check(new Set(cfg.guardianSet).size === cfg.guardianSet.length, 'guardian addresses distinct');
check(cfg.escapeHatch && cfg.escapeH]ch.testedOnTestnet === true, 'escape hatch tested on testnet');
check(cfg.escapeHatch === true && typeof cfg.escapeH]ch.evidenceUrl === 'string' && cfg.escapeHatch.evidenceUrl.startsWith('https://'), 'escape hatch evidence URL is HTTPS');

console.log('✐ all automatable promotion gates passed');