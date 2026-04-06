import * as migration_20260406_010735_initial from './20260406_010735_initial';

export const migrations = [
  {
    up: migration_20260406_010735_initial.up,
    down: migration_20260406_010735_initial.down,
    name: '20260406_010735_initial'
  },
];
