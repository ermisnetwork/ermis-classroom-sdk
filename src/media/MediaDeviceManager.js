import EventEmitter from "../events/EventEmitter.js";

class MediaDeviceManager extends EventEmitter {
  constructor() {
    super();
    
    this.devices = {
      cameras: [],
      microphones: [],
      speakers: []
    };
    
    this.selectedDevices = {
      camera: null,
      microphone: null,
      speaker: null
    };
    
    this.permissions = {
      camera: 'prompt',
      microphone: 'prompt'
    };
    
    this.isMonitoring = false;
    this._boundDeviceChangeHandler = null;
  }

  async initialize() {
    if (!navigator.mediaDevices) {
      throw new Error('Media devices not supported in this browser');
    }

    await this.refreshDevices();
    await this.checkPermissions();
    this.startMonitoring();
    
    return this.devices;
  }

  async refreshDevices() {
    try {
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      
      this.devices.cameras = deviceList
        .filter(d => d.kind === 'videoinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${this.devices.cameras.length + 1}`,
          kind: d.kind,
          groupId: d.groupId
        }));
      
      this.devices.microphones = deviceList
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${this.devices.microphones.length + 1}`,
          kind: d.kind,
          groupId: d.groupId
        }));
      
      this.devices.speakers = deviceList
        .filter(d => d.kind === 'audiooutput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker ${this.devices.speakers.length + 1}`,
          kind: d.kind,
          groupId: d.groupId
        }));

      if (!this.selectedDevices.camera && this.devices.cameras.length > 0) {
        this.selectedDevices.camera = this.devices.cameras[0].deviceId;
      }
      
      if (!this.selectedDevices.microphone && this.devices.microphones.length > 0) {
        this.selectedDevices.microphone = this.devices.microphones[0].deviceId;
      }
      
      if (!this.selectedDevices.speaker && this.devices.speakers.length > 0) {
        this.selectedDevices.speaker = this.devices.speakers[0].deviceId;
      }

      this.emit('devicesChanged', this.devices);
      
      return this.devices;
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
      throw error;
    }
  }

  async checkPermissions() {
    if (!navigator.permissions) {
      return this.permissions;
    }

    try {
      const cameraPermission = await navigator.permissions.query({ name: 'camera' });
      this.permissions.camera = cameraPermission.state;
      
      cameraPermission.addEventListener('change', () => {
        this.permissions.camera = cameraPermission.state;
        this.emit('permissionChanged', { type: 'camera', state: cameraPermission.state });
      });
    } catch (error) {
      console.warn('Camera permission check failed:', error);
    }

    try {
      const micPermission = await navigator.permissions.query({ name: 'microphone' });
      this.permissions.microphone = micPermission.state;
      
      micPermission.addEventListener('change', () => {
        this.permissions.microphone = micPermission.state;
        this.emit('permissionChanged', { type: 'microphone', state: micPermission.state });
      });
    } catch (error) {
      console.warn('Microphone permission check failed:', error);
    }

    return this.permissions;
  }

  startMonitoring() {
    if (this.isMonitoring) return;
    
    this._boundDeviceChangeHandler = () => {
      this.refreshDevices();
    };
    
    navigator.mediaDevices.addEventListener('devicechange', this._boundDeviceChangeHandler);
    this.isMonitoring = true;
  }

  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    if (this._boundDeviceChangeHandler) {
      navigator.mediaDevices.removeEventListener('devicechange', this._boundDeviceChangeHandler);
      this._boundDeviceChangeHandler = null;
    }
    
    this.isMonitoring = false;
  }

  selectCamera(deviceId) {
    const device = this.devices.cameras.find(d => d.deviceId === deviceId);
    if (!device) {
      throw new Error(`Camera with deviceId ${deviceId} not found`);
    }
    
    this.selectedDevices.camera = deviceId;
    this.emit('deviceSelected', { type: 'camera', deviceId, device });
    
    return device;
  }

  selectMicrophone(deviceId) {
    const device = this.devices.microphones.find(d => d.deviceId === deviceId);
    if (!device) {
      throw new Error(`Microphone with deviceId ${deviceId} not found`);
    }
    
    this.selectedDevices.microphone = deviceId;
    this.emit('deviceSelected', { type: 'microphone', deviceId, device });
    
    return device;
  }

  selectSpeaker(deviceId) {
    const device = this.devices.speakers.find(d => d.deviceId === deviceId);
    if (!device) {
      throw new Error(`Speaker with deviceId ${deviceId} not found`);
    }
    
    this.selectedDevices.speaker = deviceId;
    this.emit('deviceSelected', { type: 'speaker', deviceId, device });
    
    return device;
  }

  async getUserMedia(constraints = {}) {
    const finalConstraints = { ...constraints };
    
    if (constraints.video && this.selectedDevices.camera) {
      finalConstraints.video = {
        ...(typeof constraints.video === 'object' ? constraints.video : {}),
        deviceId: { exact: this.selectedDevices.camera }
      };
    }
    
    if (constraints.audio && this.selectedDevices.microphone) {
      finalConstraints.audio = {
        ...(typeof constraints.audio === 'object' ? constraints.audio : {}),
        deviceId: { exact: this.selectedDevices.microphone }
      };
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia(finalConstraints);
      await this.refreshDevices();
      return stream;
    } catch (error) {
      console.error('getUserMedia failed:', error);
      throw error;
    }
  }

  getDevices() {
    return this.devices;
  }

  getSelectedDevices() {
    return this.selectedDevices;
  }

  getPermissions() {
    return this.permissions;
  }

  destroy() {
    this.stopMonitoring();
    this.removeAllListeners();
  }
}

export default MediaDeviceManager;

