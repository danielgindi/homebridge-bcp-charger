import {PlatformConfig as HbPlatformConfig} from 'homebridge';

export interface ChargerConfig {
    code: string;
    password: string;
    name: string;
    refreshInterval: number;
    pluggedStateIsDetected: boolean;
    separateChargeSwitch: boolean;

    currentSwitches?: {
        current: number;
        name: string;
    }[];

    riskFaultSensor?: {
        name: string;
        type: 'smoke'|'leak'|'contact';
        faultContactIsDetected: boolean;
    };

    operationFaultSensor?: {
        name: string;
        type: 'smoke'|'leak'|'contact';
        faultContactIsDetected: boolean;
    };
}

export interface PlatformConfig extends HbPlatformConfig {
    chargers: ChargerConfig[];
}
