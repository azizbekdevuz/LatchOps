import { daytonaKeyPresent } from './daytona';
import { nosanaKeyPresent } from './nosana';
import type { SponsorKeyStatus } from './types';

export function readSponsorKeys(): SponsorKeyStatus {
  return {
    daytona: daytonaKeyPresent() ? 'configured' : 'missing',
    nosana: nosanaKeyPresent() ? 'configured' : 'missing',
  };
}
