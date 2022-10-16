import {PlatformConfig as HbPlatformConfig} from 'homebridge';

export interface ChargerConfig {
    code: string;
    password: string;
    name: string;
    refreshInterval: number;

    currentSwitches?: {
        current: number;
        name: string;
    }[];
}

export interface PlatformConfig extends HbPlatformConfig {
    chargers: ChargerConfig[];
}
