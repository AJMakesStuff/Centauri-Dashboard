/* CC2 JSON-RPC over MQTT. See README protocol references. */
class CC2Connection {
  constructor(settings) {
    this.readyState = 0;
    this.status = {};
    this.requests = new Map();
    this.queue = [];
    this.nextId = 0;
    this.lastRequest = 0;
    const clientId = `1_PC_${crypto.getRandomValues(new Uint32Array(1))[0]}`;
    this.root = `elegoo/${settings.serialNumber}`;
    this.requestTopic = `${this.root}/${clientId}/api_request`;
    const registrationTopic = `${this.root}/${clientId}_req/register_response`;
    const responseTopic = `${this.root}/${clientId}/api_response`;
    this.client = mqtt.connect(`ws://${settings.printerIp}:9001/mqtt`, {
      username: 'elegoo', password: settings.accessCode, clientId,
      protocolVersion: 4, clean: true, reconnectPeriod: 0,
      connectTimeout: 10000, keepalive: 30, queueQoSZero: false
    });
    this.timeout = setTimeout(() => this.fail('CC2 registration timed out. Check the serial number, LAN Only mode and port 9001.'), 15000);
    this.client.on('error', error => this.fail([4, 5].includes(error.code)
      ? 'CC2 authentication failed. Check the access code in Settings.'
      : 'CC2 MQTT connection failed. Check LAN Only mode and port 9001.'));
    this.client.on('close', () => this.close());
    this.client.on('connect', () => {
      if (this.readyState === 3) return;
      this.client.subscribe([registrationTopic, responseTopic, `${this.root}/api_status`], { qos: 0 }, (error, grants) => {
        if (this.readyState === 3) return;
        if (error || grants?.some(grant => grant.qos === 128)) return this.fail('CC2 status subscription rejected.');
        this.publish(`${this.root}/api_register`, { client_id: clientId, request_id: `${clientId}_req` });
      });
    });
    this.client.on('message', (topic, payload) => {
      if (this.readyState === 3) return;
      let raw;
      try { raw = JSON.parse(payload.toString()); } catch { return; }
      if (topic === registrationTopic) {
        if (raw.error !== 'ok') return this.fail('CC2 registration rejected. Check the printer connection limit and serial number.');
        if (this.readyState === 1) return;
        clearTimeout(this.timeout);
        this.readyState = 1;
        this.onopen?.();
        return;
      }
      if (this.readyState !== 1 || ![responseTopic, `${this.root}/api_status`].includes(topic)) return;
      if (raw.type === 'PONG') return;
      // Broadcast IDs can overlap request IDs; never interpret them as command ACKs.
      const push = [6000, 6008].includes(Number(raw.method));
      const request = !push && topic === responseTopic ? this.requests.get(raw.id) : undefined;
      if (request) this.requests.delete(raw.id);
      const result = raw.result;
      if (!result || typeof result !== 'object') return;
      if (request && result.error_code != null) {
        this.emit({ Data: { RequestID: request.id, Data: { Ack: result.error_code } } });
      }
      if (result.error_code != null && Number(result.error_code) !== 0) return;
      if (request?.method === 1042 && result.url) this.emit({ Data: { VideoUrl: result.url } });
      if (request?.method === 1002 || push) {
        if (request?.method === 1002) this.status = {};
        CC2Connection.merge(this.status, result);
        this.emit({ Status: CC2Connection.normalize(this.status) });
      }
    });
  }
  static merge(target, delta) {
    for (const [key, value] of Object.entries(delta)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
        CC2Connection.merge(target[key], value);
      } else target[key] = value;
    }
  }
  static normalize(s) {
    const machine = s.machine_status || {}, print = s.print_status || {};
    const sub = Number(machine.sub_status);
    const active = Number(machine.status) === 2 && ![2077, 2504].includes(sub);
    const code = active ? ({ 2501: 5, 2502: 6, 2505: 6, 2503: 7, 2401: 12 }[sub] || 13) : 0;
    return {
      CurrentStatus: active ? 1 : 0,
      TempOfNozzle: s.extruder?.temperature, TempTargetNozzle: s.extruder?.target,
      TempOfHotbed: s.heater_bed?.temperature, TempTargetHotbed: s.heater_bed?.target,
      TempOfBox: s.ztemperature_sensor?.temperature,
      CurrentFanSpeed: {
        ModelFan: s.fans?.fan?.speed,
        AuxiliaryFan: s.fans?.aux_fan?.speed,
        BoxFan: s.fans?.box_fan?.speed
      },
      LightStatus: s.led ? { SecondLight: s.led.status } : undefined,
      PrintInfo: {
        Filename: print.filename, Status: code, CurrentLayer: print.current_layer,
        TotalLayer: print.total_layer, CurrentTicks: print.print_duration,
        TotalTicks: print.total_duration, RemainingSeconds: print.remaining_time_sec,
        Progress: machine.progress
      }
    };
  }
  emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  publish(topic, payload) {
    if (!this.client.connected || this.readyState === 3) return;
    this.client.publish(topic, JSON.stringify(payload), { qos: 0, retain: false }, error => {
      if (error && this.readyState !== 3) this.fail('CC2 request could not be sent.');
    });
  }
  send(payload) {
    if (this.readyState !== 1) throw new Error('CC2 is disconnected');
    if (payload === 'ping') {
      this.publish(this.requestTopic, { type: 'PING' });
      this.enqueue(1002, {});
      return;
    }
    const data = JSON.parse(payload).Data;
    let method = { 0: 1002, 1: 1001, 386: 1042, 129: 1021, 130: 1022, 131: 1023, 403: 1029 }[data.Cmd];
    if (!method) throw new Error('Unsupported CC2 command');
    let params = {};
    if (data.Cmd === 403) {
      const payload = data.Data;
      if (payload.TargetFanSpeed) {
        method = 1030;
        for (const [source, target] of Object.entries({ ModelFan: 'fan', AuxiliaryFan: 'aux_fan', BoxFan: 'box_fan' })) {
          if (payload.TargetFanSpeed[source] != null) params[target] = Math.round(payload.TargetFanSpeed[source] * 255 / 100);
        }
      } else if ('TempTargetNozzle' in payload || 'TempTargetHotbed' in payload) {
        method = 1028;
        if ('TempTargetNozzle' in payload) params.extruder = payload.TempTargetNozzle;
        if ('TempTargetHotbed' in payload) params.heater_bed = payload.TempTargetHotbed;
      } else params = { power: payload.LightStatus.SecondLight };
    }
    this.enqueue(method, params, data.RequestID);
  }
  enqueue(method, params, id) {
    if (method === 1002 && this.queue.some(item => item.method === 1002)) return;
    const item = { method, params, id };
    // User actions take priority over background reads; requests are never replayed after disconnect.
    if ([1021, 1022, 1023, 1028, 1029, 1030].includes(method)) this.queue.unshift(item);
    else this.queue.push(item);
    this.flush();
  }
  flush() {
    clearTimeout(this.queueTimer);
    if (this.readyState !== 1 || !this.queue.length) return;
    const wait = Math.max(0, this.lastRequest + 2200 - Date.now());
    if (wait) { this.queueTimer = setTimeout(() => this.flush(), wait); return; }
    const request = this.queue.shift(), id = ++this.nextId;
    this.lastRequest = Date.now();
    for (const [key, item] of this.requests) if (Date.now() - item.sent > 30000) this.requests.delete(key);
    this.requests.set(id, { ...request, sent: Date.now() });
    this.publish(this.requestTopic, { id, method: request.method, params: request.params });
    this.flush();
  }
  fail(message) { this.onerror?.({ message }); this.close(); }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    clearTimeout(this.timeout); clearTimeout(this.queueTimer);
    this.queue = []; this.requests.clear(); this.status = {};
    this.client.end(true);
    this.onclose?.();
  }
}
