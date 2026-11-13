// Project files and manufacturer JSON validation.
import { describe, it, expect } from 'vitest';
import { caseInputs } from './golden/run';
import { defaultCatalog, DESIGN_DEFAULTS } from '../src/data/catalog';
import { makeProject, readProject, validateMfrs, PROJECT_VERSION } from '../src/data/project';
import { study, rank } from '../src/engine';

describe('project save and load', () => {
  it('round trip reproduces the same study result, including catalog edits and runs', () => {
    const o = caseInputs('a-default-office-corridor'), cat = defaultCatalog();
    cat.inst.crew = 4200; cat.panels[3].override = { EI: 120, src: 'test' }; cat.panels[3].EI = 120;
    const best = rank(o, study(o, cat))[0];
    const text = JSON.stringify(makeProject({ name: 'Test', by: 'me', inputs: o, catalog: cat, runs: [{ label: 'Run 1', o, cfg: best.cfg }], pinned: best.cfg }));
    const { project, warnings } = readProject(text);
    expect(warnings).toEqual([]);
    expect(project.catalog.inst.crew).toBe(4200);
    expect(project.catalog.panels[3].EI).toBe(120);
    expect(project.runs[0].cfg).toEqual(best.cfg);
    const again = rank(project.inputs, study(project.inputs, project.catalog))[0];
    expect(again.r!.cpsf).toBe(best.r!.cpsf);
  });
  it('older files get defaults for inputs added later, with a warning', () => {
    const o = caseInputs('b-residential-single-bay') as unknown as Record<string, unknown>;
    for (const k of Object.keys(DESIGN_DEFAULTS)) delete o[k];
    const { project, warnings } = readProject(JSON.stringify({ app: 'mt-floor-tool', version: 1, inputs: o }));
    expect(project.inputs.method).toBe('ASD');
    expect(project.inputs.vibMethod).toBe('guide');
    expect(warnings[0]).toMatch(/defaults were used/);
  });
  it('rejects other files and newer versions', () => {
    expect(() => readProject('not json')).toThrow(/Not a JSON/);
    expect(() => readProject('{"app":"other"}')).toThrow(/Not a project/);
    expect(() => readProject(JSON.stringify({ app: 'mt-floor-tool', version: PROJECT_VERSION + 1, inputs: {} }))).toThrow(/newer/);
  });
});

describe('manufacturer JSON', () => {
  it('the shipped list is valid and every entry has verified flags', () => {
    const m = defaultCatalog().mfrs;
    expect(validateMfrs(m)).toEqual([]);
    expect(m.every(x => x.verified && typeof x.verified.cltSize === 'boolean')).toBe(true);
  });
  it('reports readable errors', () => {
    const e = validateMfrs([{ name: 'X', plant: 'Y', ll: [1], c: 'MX', clt: { w: 0 }, gl: 'yes', grades: null, pf: 0 }]);
    expect(e.join(' ')).toMatch(/ll must be/);
    expect(e.join(' ')).toMatch(/c must be/);
    expect(e.join(' ')).toMatch(/clt must be/);
    expect(e.join(' ')).toMatch(/gl must be/);
    expect(e.join(' ')).toMatch(/pf must be/);
  });
});
