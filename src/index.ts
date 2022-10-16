import {API, PlatformPluginConstructor} from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { ChargerHomebridgePlatform } from './platform';

/**
 * This method registers the platform with Homebridge
 */
export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, ChargerHomebridgePlatform as unknown as PlatformPluginConstructor);
};
