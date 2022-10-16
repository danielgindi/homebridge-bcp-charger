import {PlatformAccessory, Service} from 'homebridge';

import {ChargerHomebridgePlatform} from './platform';
import {ChargerConfig} from './platformConfig';
import type {
  ChargerController,
  ChargerModel,
  ChargerRealTimeData,
  ChargeFaultStatus,
  ChargerControlsState,
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
} from '@danielgindi/bcp-charger-api';
import * as uuid from 'uuid';
import {PLATFORM_NAME, PLUGIN_NAME} from './settings';

export class ChargerAccessory {
  private chargerController: ChargerController | null = null;
  private commandFaultCount = 0;

  private states = {
    plugged: null as (boolean | null),
    charging: null as (boolean | null),
    maxCurrent: null as (number | null),
  };

  private currentSwitches = new Map<number, Service>();
  private accessoryUuids = new Set<string>();
  private accessories: PlatformAccessory[] = [];

  constructor(
    private readonly platform: ChargerHomebridgePlatform,
    private readonly platformAccessories: PlatformAccessory[],
    private readonly config: ChargerConfig,
  ) {
    // noinspection JSIgnoredPromiseFromCall
    this.setup();
  }

  hasAccessoryUuid(uuid: string) {
    return this.accessoryUuids.has(uuid);
  }

  private getOrAddAccessory(uuid: string, displayName: string): PlatformAccessory {
    let accessory = this.platformAccessories.find(accessory => accessory.UUID === uuid);
    if (accessory) {
      this.platform.log.info('Restoring existing accessory from cache:', accessory.displayName, uuid);
    } else {
      this.platform.log.info('Adding new accessory:', displayName, uuid);
      accessory = new this.platform.api.platformAccessory(displayName, uuid);
      this.platform.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.platformAccessories.push(accessory);
    }

    this.accessoryUuids.add(uuid);
    this.accessories.push(accessory);

    const accessoryInformationService = accessory.getService(this.platform.Service.AccessoryInformation);
    accessoryInformationService?.setCharacteristic(this.platform.Characteristic.SerialNumber, this.config.code);

    return accessory;
  }

  async setup() {
    const mainUuid = this.platform.api.hap.uuid.generate(this.config.code);
    const mainAccessory = this.getOrAddAccessory(mainUuid, this.config.name);

    const UUID_PLUGGED_CONTACT_SENSOR = uuid.v5('plugged-contact', mainAccessory.UUID);
    const UUID_TEMPERATURE_SENSOR = uuid.v5('temperature', mainAccessory.UUID);
    const UUID_CHARGER_SWITCH = uuid.v5('charger-switch', mainAccessory.UUID);

    const legitimateServices = new Set();

    const pluggedContactSensor = mainAccessory.getService('Plugged sensor') ||
      mainAccessory.addService(this.platform.Service.ContactSensor, 'Plugged sensor', UUID_PLUGGED_CONTACT_SENSOR);
    legitimateServices.add(pluggedContactSensor.UUID);

    const temperatureSensor = mainAccessory.getService('Temperature sensor') ||
      mainAccessory.addService(this.platform.Service.TemperatureSensor, 'Temperature sensor', UUID_TEMPERATURE_SENSOR);
    legitimateServices.add(temperatureSensor.UUID);

    const chargerSwitch = mainAccessory.getService('Charging Switch') ||
      mainAccessory.addService(this.platform.Service.Switch, 'Charging Switch', UUID_CHARGER_SWITCH);
    legitimateServices.add(chargerSwitch.UUID);

    for (const switchConfig of this.config.currentSwitches ?? []) {
      if (this.currentSwitches.has(switchConfig.current)) {
        continue;
      }

      const currentUuid = uuid.v5('current-switch-' + switchConfig.current, mainAccessory.UUID);
      const accessory = this.getOrAddAccessory(currentUuid, this.config.name + ' - ' + switchConfig.name);

      const currentSwitch = accessory.getService(this.platform.Service.Switch) || accessory.addService(this.platform.Service.Switch);

      legitimateServices.add(currentSwitch.UUID);

      currentSwitch.setCharacteristic(this.platform.Characteristic.Name,
        switchConfig.name || ('Current Switch ' + switchConfig.current + 'A'));

      currentSwitch.getCharacteristic(this.platform.Characteristic.On)
        .onSet(async () => await this.setCurrent(switchConfig.current));

      this.currentSwitches.set(switchConfig.current, currentSwitch);
    }

    chargerSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async v => {
        if (v) {
          await this.chargerController?.sendSetChargeState(true);
          this.states.charging = true;
          chargerSwitch.updateCharacteristic(this.platform.Characteristic.On, 1);
        } else {
          await this.chargerController?.sendSetChargeState(false);
          this.states.charging = false;
          chargerSwitch.updateCharacteristic(this.platform.Characteristic.On, 0);
        }
      });

    this.platform.log.info('Initializing charger with code: ' + this.config.code + ' and password: ' + this.config.password);

    const {ChargerController, ChargerState} = await import('@danielgindi/bcp-charger-api');
    this.chargerController = new ChargerController(this.config.password);
    this.chargerController.resultTimeout = 3000;

    this.chargerController.on('charger_model', (model: ChargerModel) => {
      for (const accessory of this.accessories) {
        const accessoryInformationService = accessory.getService(this.platform.Service.AccessoryInformation);
        accessoryInformationService
          ?.setCharacteristic(this.platform.Characteristic.Model, model.version)
          ?.setCharacteristic(this.platform.Characteristic.Version, model.firmwareVersion);
      }
    });

    this.chargerController.on('realtime_data', async (data: ChargerRealTimeData) => {
      this.states.plugged = data.state === ChargerState.Standby ||
        data.state === ChargerState.Charging ||
        data.state === ChargerState.NotReady;
      this.states.charging = data.state === ChargerState.Charging;
      this.states.maxCurrent = data.maxCurrent ?? null;

      pluggedContactSensor.updateCharacteristic(
        this.platform.Characteristic.ContactSensorState,
        this.states.plugged
          ? this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
          : this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);

      temperatureSensor.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        data.temperature);

      chargerSwitch.updateCharacteristic(this.platform.Characteristic.On, this.states.charging ? 1 : 0);
    });

    this.chargerController.on('controls_state', async (state: ChargerControlsState) => {
      this.states.maxCurrent = state.maxCurrent ?? null;
      this.updateCurrentSwitches();
    });

    this.chargerController.on('fault_status', (status: ChargeFaultStatus) => {
      temperatureSensor.updateCharacteristic(
        this.platform.Characteristic.StatusFault,
        status.highTemperature
          ? this.platform.Characteristic.StatusFault.GENERAL_FAULT
          : this.platform.Characteristic.StatusFault.NO_FAULT);
    });

    for (const accessory of this.platformAccessories) {
      for (const service of accessory.services) {
        if (legitimateServices.has(service.UUID) ||
          service instanceof this.platform.Service.AccessoryInformation) {
          continue;
        }

        this.platform.log.info('Removing service', service.UUID, service.name, service.displayName);
        accessory.removeService(service);
      }
    }

    await this.startUpdates();
  }

  async setCurrent(current: number): Promise<boolean> {
    if (!await this.chargerController?.sendSetMaxCurrent(current)) {
      return false;
    }

    this.states.maxCurrent = current;

    this.updateCurrentSwitches();

    return true;
  }

  updateCurrentSwitches() {
    for (const [current, currentSwitch] of this.currentSwitches) {
      currentSwitch.updateCharacteristic(
        this.platform.Characteristic.On,
        current === this.states.maxCurrent ? 1 : 0);
    }
  }

  async startUpdates() {
    const resolveIp = async () => {
      this.platform.log.info('Charger ' + this.config.code + ': Broadcasting request for ip address');
      try {
        if (await this.chargerController?.sendGetIpAddress(this.config.code)) {
          this.platform.log.info('Charger ' + this.config.code + ': Got an IP address: ' + this.chargerController?.host.ipAddress);
          this.platform.log.info('Charger ' + this.config.code + ': Requesting model info');
          await this.chargerController?.sendGetChargerModel();
          this.platform.log.info('Charger ' + this.config.code + ': Received model info');
        }
        return true;
      } catch (err) {
        this.platform.log.error('Charger ' + this.config.code + ': Failed to get ip address');
        return false;
      }
    };

    if (!await resolveIp()) {
      setTimeout(() => this.startUpdates(), 10000);
      return;
    }

    this.platform.log.info('Starting updates for charger ' + this.config.code);
    setInterval(async () => {
      if (this.chargerController?.host.ipAddress === '255.255.255.255') {
        this.platform.log.info('Charger ' + this.config.code + ': IP is 255.255.255.255, requesting new IP');
        if (!await resolveIp()) {
          return;
        }
      }

      if (this.chargerController?.host.ipAddress !== '255.255.255.255') {
        try {
          this.platform.log.debug('Charger ' + this.config.code + ': Requesting state');
          await Promise.all([
            this.chargerController?.sendGetRealTimeData(),
            this.chargerController?.sendGetFaultStatus(),
            this.chargerController?.sendGetControlsState(),
          ]);
        } catch (err) {
          this.platform.log.error('Charger ' + this.config.code + ': Failed to fetch state. ' + (err as Error).message);
          this.commandFaultCount++;

          if (this.commandFaultCount === 10) {
            this.commandFaultCount = 0;
            await this.chargerController?.resetHost();
          }
        }
      }
    }, this.config.refreshInterval || 5000);
  }
}
