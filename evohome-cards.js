/**
 * Evohome Cards v10
 * A custom Lovelace card for Honeywell Evohome zones.
 *
 * Config options:
 *   entity:           (required) climate entity
 *   name:             (optional) display name override
 *   show_hvac_toggle: (optional) default true
 *   show_accent_bar:  (optional) default true
 *   temp_pills:       (optional) default false - tinted background pills on temps
 *   compact:          (optional) default false - minimal status-only view
 */
class EvohomeZoneCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._localTemp = null;
    this._durationMins = 60;
    this._showCustomDuration = false;
    this._dirty = false;
    this._loading = false;
    this._expectedMode = null;
    this._loadingTimeout = null;
    this._countdownInterval = null;
    this._expanded = false;
  }

  static getStubConfig() {
    return { entity: "climate.living_room" };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("You must define an entity (climate.xxx)");
    }
    this._config = {
      entity: config.entity,
      name: config.name || null,
      show_hvac_toggle: config.show_hvac_toggle !== false,
      show_accent_bar: config.show_accent_bar !== false,
      temp_pills: config.temp_pills === true,
      compact: config.compact === true,
    };
    this._localTemp = null;
    this._durationMins = 60;
    this._showCustomDuration = false;
    this._dirty = false;
    this._loading = false;
    this._expectedMode = null;
    this._expanded = false;
    this._render();
  }

  set hass(hass) {
    var oldHass = this._hass;
    this._hass = hass;

    if (!oldHass || !this._config.entity) {
      this._render();
      return;
    }

    var oldState = oldHass.states[this._config.entity];
    var newState = hass.states[this._config.entity];

    if (oldState !== newState) {
      if (!this._dirty) {
        this._localTemp = null;
      }

      if (this._loading) {
        var shouldClear = false;
        if (!newState || !this._expectedMode) {
          shouldClear = true;
        } else {
          var attrs = newState.attributes || {};
          var status = attrs.status || {};
          var setpointStatus = status.setpoint_status || {};
          var currentMode = setpointStatus.setpoint_mode || "FollowSchedule";
          if (currentMode === this._expectedMode) {
            shouldClear = true;
          }
        }
        if (shouldClear) {
          this._loading = false;
          this._expectedMode = null;
          if (this._loadingTimeout) {
            clearTimeout(this._loadingTimeout);
            this._loadingTimeout = null;
          }
        }
      }

      this._render();
    }
  }

  _tempColor(temp) {
    if (temp === null || temp === undefined) return "#9c9c9c";
    if (temp >= 25) return "#fc0000";
    if (temp >= 22) return "#fc6c28";
    if (temp >= 19) return "#fc9828";
    if (temp >= 16) return "#7cbc58";
    if (temp > 5) return "#6ca4fc";
    return "#9c9c9c";
  }

  _tempColorRgb(temp) {
    if (temp === null || temp === undefined) return "156,156,156";
    if (temp >= 25) return "252,0,0";
    if (temp >= 22) return "252,108,40";
    if (temp >= 19) return "252,152,40";
    if (temp >= 16) return "124,188,88";
    if (temp > 5) return "108,164,252";
    return "156,156,156";
  }

  _pillStyle(temp) {
    if (!this._config.temp_pills) return "";
    var rgb = this._tempColorRgb(temp);
    var color = this._tempColor(temp);
    return "background:rgba(" + rgb + ",0.12); color:" + color + "; padding:4px 10px; border-radius:12px; display:inline-block;";
  }

  _compactPillStyle(temp) {
    if (!this._config.temp_pills) return "";
    var rgb = this._tempColorRgb(temp);
    var color = this._tempColor(temp);
    return "background:rgba(" + rgb + ",0.12); color:" + color + "; padding:2px 8px; border-radius:10px; display:inline-block;";
  }

  _escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  _getEntity() {
    if (!this._hass || !this._config.entity) return null;
    return this._hass.states[this._config.entity];
  }

  _getStatus(entity) {
    var attrs = entity.attributes;
    var status = attrs.status || {};
    var setpoints = status.setpoints || {};
    var setpointStatus = status.setpoint_status || {};
    var tempStatus = status.temperature_status || {};
    var faults = status.activeFaults || [];

    return {
      friendlyName: this._config.name || attrs.friendly_name || "Zone",
      currentTemp: attrs.current_temperature,
      targetTemp: attrs.temperature,
      presetMode: attrs.preset_mode,
      hvacMode: entity.state,
      minTemp: attrs.min_temp || 5,
      maxTemp: attrs.max_temp || 35,
      thisSpFrom: setpoints.this_sp_from,
      thisSpTemp: setpoints.this_sp_temp,
      nextSpFrom: setpoints.next_sp_from,
      nextSpTemp: setpoints.next_sp_temp,
      setpointMode: setpointStatus.setpoint_mode || "FollowSchedule",
      targetHeatTemp: setpointStatus.target_heat_temperature,
      overrideUntil: setpointStatus.until || null,
      sensorTemp: tempStatus.temperature,
      sensorAvailable: tempStatus.is_available !== false,
      activeFaults: faults,
    };
  }

  _isOverride(status) {
    return (
      status.setpointMode === "TemporaryOverride" ||
      status.setpointMode === "PermanentOverride"
    );
  }

  _formatTime(isoString) {
    if (!isoString) return "\u2014";
    var d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  _formatDate(isoString) {
    if (!isoString) return "";
    var d = new Date(isoString);
    var now = new Date();
    var tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === now.toDateString()) return "today";
    if (d.toDateString() === tomorrow.toDateString()) return "tomorrow";
    return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  }

  _timeRemaining(untilIso) {
    if (!untilIso) return null;
    var now = new Date();
    var until = new Date(untilIso);
    var diffMs = until - now;
    if (diffMs <= 0) return "expired";
    var hours = Math.floor(diffMs / 3600000);
    var mins = Math.floor((diffMs % 3600000) / 60000);
    if (hours > 0) return hours + "h " + mins + "m remaining";
    return mins + "m remaining";
  }

  _durationToEndTime(mins) {
    var d = new Date();
    d.setMinutes(d.getMinutes() + mins);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  _getEffectiveTarget(status) {
    if (this._isOverride(status)) {
      return status.targetHeatTemp !== undefined ? status.targetHeatTemp : status.targetTemp;
    }
    return status.thisSpTemp !== undefined && status.thisSpTemp !== null
      ? status.thisSpTemp
      : status.targetTemp;
  }

  _handleTempChange(delta) {
    var entity = this._getEntity();
    if (!entity) return;
    var status = this._getStatus(entity);
    var current = this._localTemp !== null ? this._localTemp : this._getEffectiveTarget(status);
    var newTemp = Math.min(status.maxTemp, Math.max(status.minTemp, current + delta));
    this._localTemp = Math.round(newTemp * 2) / 2;
    this._dirty = true;
    this._render();
  }

  _setDuration(mins) {
    this._durationMins = mins;
    this._showCustomDuration = false;
    this._dirty = true;
    this._render();
  }

  _toggleCustomDuration() {
    this._showCustomDuration = !this._showCustomDuration;
    this._render();
  }

  _handleCustomHours(val) {
    var hours = parseInt(val, 10) || 0;
    var currentMins = this._durationMins % 60;
    this._durationMins = Math.min(1439, (hours * 60) + currentMins);
    if (this._durationMins < 1) this._durationMins = 1;
    this._dirty = true;
    this._render();
  }

  _handleCustomMins(val) {
    var mins = parseInt(val, 10) || 0;
    var currentHours = Math.floor(this._durationMins / 60);
    this._durationMins = Math.min(1439, (currentHours * 60) + mins);
    if (this._durationMins < 1) this._durationMins = 1;
    this._dirty = true;
    this._render();
  }

  _startLoading(expectedMode) {
    var self = this;
    this._loading = true;
    this._expectedMode = expectedMode || null;

    if (this._loadingTimeout) clearTimeout(this._loadingTimeout);
    this._loadingTimeout = setTimeout(function () {
      self._loading = false;
      self._expectedMode = null;
      self._loadingTimeout = null;
      self._render();
    }, 30000);

    this._render();
  }

  _stopLoading() {
    this._loading = false;
    this._expectedMode = null;
    if (this._loadingTimeout) {
      clearTimeout(this._loadingTimeout);
      this._loadingTimeout = null;
    }
    this._render();
  }

  _applyOverride() {
    var entity = this._getEntity();
    if (!entity || !this._hass) return;
    var status = this._getStatus(entity);

    var temp = this._localTemp !== null ? this._localTemp : this._getEffectiveTarget(status);
    var totalMins = Math.min(1439, Math.max(1, this._durationMins));
    var draftTemp = this._localTemp;
    var draftDirty = this._dirty;

    this._localTemp = null;
    this._dirty = false;
    this._startLoading("TemporaryOverride");

    this._hass
      .callService("evohome", "set_zone_override", {
        entity_id: this._config.entity,
        setpoint: temp,
        duration: {
          hours: Math.floor(totalMins / 60),
          minutes: totalMins % 60,
        },
      })
      .catch(function (err) {
        console.error("Evohome override failed:", err);
        this._localTemp = draftTemp;
        this._dirty = draftDirty;
        this._stopLoading();
      }.bind(this));
  }

  _applyPermanentOverride() {
    var entity = this._getEntity();
    if (!entity || !this._hass) return;
    var status = this._getStatus(entity);

    var temp = this._localTemp !== null ? this._localTemp : this._getEffectiveTarget(status);
    var draftTemp = this._localTemp;
    var draftDirty = this._dirty;

    this._localTemp = null;
    this._dirty = false;
    this._startLoading("PermanentOverride");

    this._hass
      .callService("evohome", "set_zone_override", {
        entity_id: this._config.entity,
        setpoint: temp,
      })
      .catch(function (err) {
        console.error("Evohome permanent override failed:", err);
        this._localTemp = draftTemp;
        this._dirty = draftDirty;
        this._stopLoading();
      }.bind(this));
  }

  _cancelOverride() {
    if (!this._hass) return;

    this._localTemp = null;
    this._dirty = false;
    this._startLoading("FollowSchedule");

    this._hass
      .callService("evohome", "clear_zone_override", {
        entity_id: this._config.entity,
      })
      .catch(function (err) {
        console.error("Evohome cancel override failed:", err);
        this._stopLoading();
      }.bind(this));
  }

  _toggleHvac() {
    var entity = this._getEntity();
    if (!entity || !this._hass) return;
    var newMode = entity.state === "heat" ? "off" : "heat";

    this._startLoading(null);

    this._hass
      .callService("climate", "set_hvac_mode", {
        entity_id: this._config.entity,
        hvac_mode: newMode,
      })
      .catch(function (err) {
        console.error("HVAC toggle failed:", err);
        this._stopLoading();
      }.bind(this));
  }

  _toggleExpanded() {
    this._expanded = !this._expanded;
    this._render();
  }

  _startCountdown() {
    if (this._countdownInterval) clearInterval(this._countdownInterval);
    var self = this;
    this._countdownInterval = setInterval(function () {
      var el = self.shadowRoot.querySelector(".countdown");
      if (!el) return;
      var entity = self._getEntity();
      if (!entity) return;
      var status = self._getStatus(entity);
      if (status.overrideUntil) {
        var remaining = self._timeRemaining(status.overrideUntil);
        if (remaining) el.textContent = remaining;
      }
    }, 30000);
  }

  disconnectedCallback() {
    if (this._countdownInterval) clearInterval(this._countdownInterval);
    if (this._loadingTimeout) clearTimeout(this._loadingTimeout);
  }

  _buildStyles(accentColor) {
    var accentBarCss = this._config.show_accent_bar
      ? "ha-card { border-top: 4px solid " + accentColor + "; }"
      : "";

    return [
      ":host {",
      "  --card-bg: var(--ha-card-background, var(--card-background-color, #fff));",
      "  --primary-text: var(--primary-text-color, #212121);",
      "  --secondary-text: var(--secondary-text-color, #727272);",
      "  --evo-red: #fc0000;",
      "  --evo-orange: #fc6c28;",
      "  --evo-amber: #fc9828;",
      "  --evo-green: #7cbc58;",
      "  --evo-blue: #6ca4fc;",
      "  --evo-grey: #9c9c9c;",
      "  --divider: var(--divider-color, #e0e0e0);",
      "}",
      "ha-card { padding: 0; overflow: hidden; position: relative; }",
      accentBarCss,
      ".card-content { padding: 16px 20px; }",
      "",
      ".loading-overlay { position:absolute; top:0; left:0; right:0; bottom:0; background:rgba(255,255,255,0.7); display:flex; align-items:center; justify-content:center; z-index:10; border-radius:var(--ha-card-border-radius, 12px); }",
      "@keyframes spin { 0% { transform:rotate(0deg); } 100% { transform:rotate(360deg); } }",
      ".spinner { width:36px; height:36px; border:3px solid var(--divider); border-top-color:var(--evo-blue); border-radius:50%; animation:spin 0.8s linear infinite; }",
      "",
      "/* Header */",
      ".header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }",
      ".header-left { display:flex; align-items:center; gap:10px; }",
      ".room-name { font-size:1.1em; font-weight:600; color:var(--primary-text); }",
      ".mode-badge { display:inline-block; font-size:0.65em; font-weight:600; padding:2px 8px; border-radius:10px; letter-spacing:0.02em; text-transform:uppercase; }",
      ".mode-badge.schedule { background:var(--evo-green); color:white; }",
      ".mode-badge.override { background:var(--evo-orange); color:white; }",
      ".mode-badge.permanent { background:var(--evo-red); color:white; }",
      ".mode-badge.off { background:var(--evo-grey); color:white; }",
      ".hvac-toggle { cursor:pointer; background:none; border:1px solid var(--divider); border-radius:8px; padding:4px 10px; font-size:0.75em; color:var(--secondary-text); transition:all 0.2s; }",
      ".hvac-toggle:hover { border-color:var(--evo-blue); color:var(--evo-blue); }",
      "",
      "/* Faults */",
      ".faults { background:var(--evo-red); color:white; padding:6px 12px; border-radius:8px; margin-bottom:12px; font-size:0.8em; display:flex; align-items:center; gap:6px; }",
      "",
      "/* Temperature section */",
      ".temp-section { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }",
      ".current-temp-block { text-align:left; }",
      ".current-temp-label { font-size:0.65em; color:var(--secondary-text); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px; }",
      ".current-temp { font-size:3em; font-weight:300; line-height:1; }",
      ".current-temp .unit { font-size:0.4em; vertical-align:super; }",
      ".target-control { display:flex; align-items:center; gap:4px; }",
      ".temp-btn { width:36px; height:36px; border-radius:50%; border:1.5px solid var(--divider); background:var(--card-bg); font-size:1.2em; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.15s; user-select:none; line-height:1; padding:0; }",
      ".temp-btn.up { color:var(--evo-red); border-color:var(--evo-red); }",
      ".temp-btn.up:hover { background:rgba(252,0,0,0.06); }",
      ".temp-btn.down { color:var(--evo-blue); border-color:var(--evo-blue); }",
      ".temp-btn.down:hover { background:rgba(108,164,252,0.06); }",
      ".temp-btn:active { transform:scale(0.93); }",
      ".target-temp-display { text-align:center; min-width:60px; }",
      ".target-temp-label { font-size:0.65em; color:var(--secondary-text); text-transform:uppercase; letter-spacing:0.05em; }",
      ".target-temp-value { font-size:1.6em; font-weight:500; line-height:1.1; }",
      ".target-temp-value .unit { font-size:0.4em; vertical-align:super; }",
      "",
      "/* Schedule line */",
      ".schedule-line { font-size:0.8em; color:var(--secondary-text); margin-bottom:12px; padding:0 2px; }",
      ".schedule-line span { color:var(--primary-text); font-weight:500; }",
      "",
      "/* Override info */",
      ".override-info { border-radius:8px; padding:10px 12px; margin-bottom:12px; font-size:0.8em; }",
      ".override-info.temp { background:rgba(252,108,40,0.08); border:1px solid rgba(252,108,40,0.2); }",
      ".override-info.perm { background:rgba(252,0,0,0.08); border:1px solid rgba(252,0,0,0.2); }",
      ".override-row { display:flex; justify-content:space-between; align-items:center; }",
      ".countdown { font-weight:600; color:var(--evo-orange); }",
      ".countdown.permanent { color:var(--evo-red); }",
      ".override-detail { margin-top:3px; font-size:0.9em; color:var(--secondary-text); }",
      "",
      "/* Controls panel */",
      ".controls-panel { overflow:hidden; transition:max-height 0.25s ease, opacity 0.2s ease; }",
      ".controls-panel.hidden { max-height:0; opacity:0; margin:0; }",
      ".controls-panel.visible { max-height:300px; opacity:1; }",
      "",
      "/* Duration */",
      ".duration-section { margin-bottom:12px; }",
      ".duration-label { color:var(--secondary-text); font-size:0.8em; margin-bottom:6px; display:block; }",
      ".duration-buttons { display:flex; gap:5px; flex-wrap:wrap; }",
      ".dur-btn { padding:6px 11px; border:1.5px solid var(--divider); border-radius:8px; background:var(--card-bg); color:var(--primary-text); font-size:0.8em; font-weight:500; cursor:pointer; transition:all 0.15s; font-family:inherit; }",
      ".dur-btn:hover { border-color:var(--evo-blue); color:var(--evo-blue); }",
      ".dur-btn.active { background:var(--evo-blue); color:white; border-color:var(--evo-blue); }",
      ".dur-btn:active { transform:scale(0.95); }",
      ".duration-end-time { font-size:0.75em; color:var(--secondary-text); margin-top:5px; }",
      ".custom-duration { display:flex; align-items:center; gap:6px; margin-top:6px; }",
      ".custom-duration select { padding:6px 8px; border:1.5px solid var(--divider); border-radius:8px; font-size:0.85em; background:var(--card-bg); color:var(--primary-text); font-family:inherit; cursor:pointer; }",
      ".custom-duration select:focus { outline:none; border-color:var(--evo-blue); }",
      ".custom-duration-label { font-size:0.8em; color:var(--secondary-text); }",
      "",
      "/* Actions */",
      ".actions { display:flex; gap:8px; flex-wrap:wrap; }",
      ".btn { flex:1; padding:9px 12px; border:none; border-radius:8px; font-size:0.8em; font-weight:600; cursor:pointer; transition:all 0.15s; font-family:inherit; min-width:0; }",
      ".btn:active { transform:scale(0.97); }",
      ".btn-override { background:var(--evo-blue); color:white; }",
      ".btn-override:hover { filter:brightness(1.1); }",
      ".btn-permanent { background:var(--evo-red); color:white; }",
      ".btn-permanent:hover { filter:brightness(1.1); }",
      ".btn-cancel { background:transparent; color:var(--evo-green); border:1.5px solid var(--evo-green); }",
      ".btn-cancel:hover { background:rgba(124,188,88,0.08); }",
      "",
      "/* Compact mode */",
      ".compact-row { display:flex; align-items:center; justify-content:space-between; cursor:pointer; }",
      ".compact-left { display:flex; align-items:center; gap:10px; }",
      ".compact-name { font-size:1em; font-weight:600; color:var(--primary-text); }",
      ".compact-temps { display:flex; align-items:baseline; gap:16px; }",
      ".compact-current { font-size:1.8em; font-weight:300; line-height:1; }",
      ".compact-current .unit { font-size:0.4em; vertical-align:super; }",
      ".compact-target { font-size:1em; color:var(--secondary-text); }",
      ".compact-target .val { font-weight:500; }",
      ".compact-target .unit { font-size:0.8em; }",
    ].join("\n");
  }

  _buildHoursOptions() {
    var currentH = Math.floor(this._durationMins / 60);
    var html = "";
    for (var i = 0; i <= 23; i++) {
      var sel = i === currentH ? " selected" : "";
      html += "<option value='" + i + "'" + sel + ">" + i + "</option>";
    }
    return html;
  }

  _buildMinsOptions() {
    var currentM = this._durationMins % 60;
    var html = "";
    for (var i = 0; i < 60; i += 5) {
      var sel = false;
      if (i <= currentM && (i + 5) > currentM) sel = true;
      var selAttr = sel ? " selected" : "";
      var label = String(i).padStart(2, "0");
      html += "<option value='" + i + "'" + selAttr + ">" + label + "</option>";
    }
    return html;
  }

  _render() {
    var entity = this._getEntity();

    if (!entity) {
      var escapedEntity = this._escapeHtml(this._config.entity || "");
      this.shadowRoot.innerHTML =
        "<ha-card><div style='padding:16px;color:red;'>Entity not found: " +
        escapedEntity +
        "</div></ha-card>";
      return;
    }

    var s = this._getStatus(entity);
    var isOver = this._isOverride(s);
    var isTemp = s.setpointMode === "TemporaryOverride";
    var isPerm = s.setpointMode === "PermanentOverride";
    var isOff = s.hvacMode === "off";
    var hasFaults = s.activeFaults && s.activeFaults.length > 0;

    var effectiveTarget = this._getEffectiveTarget(s);
    var displayTemp = this._localTemp !== null ? this._localTemp : effectiveTarget;

    var remaining = isTemp ? this._timeRemaining(s.overrideUntil) : null;

    var currentTempColor = isOff ? "#9c9c9c" : this._tempColor(s.currentTemp);
    var targetTempColor = isOff ? "#9c9c9c" : this._tempColor(displayTemp);
    var accentColor = currentTempColor;

    var loadingHtml = this._loading
      ? '<div class="loading-overlay"><div class="spinner"></div></div>'
      : "";

    // Compact mode
    if (this._config.compact && !this._expanded && !this._dirty && !this._loading) {
      var compactBadge;
      if (isOff) {
        compactBadge = '<span class="mode-badge off">Off</span>';
      } else if (isPerm) {
        compactBadge = '<span class="mode-badge permanent">Permanent</span>';
      } else if (isOver) {
        compactBadge = '<span class="mode-badge override">Override</span>';
      } else {
        compactBadge = '<span class="mode-badge schedule">Schedule</span>';
      }

      var compCurrentStr = s.currentTemp !== null && s.currentTemp !== undefined
        ? s.currentTemp.toFixed(1) : "\u2014";
      var compTargetStr = displayTemp !== null && displayTemp !== undefined
        ? displayTemp.toFixed(1) : "\u2014";

      var compCurrentPill = this._compactPillStyle(s.currentTemp);
      var compTargetPill = this._compactPillStyle(displayTemp);

      var compCurrentStyle = compCurrentPill
        ? compCurrentPill
        : "color:" + currentTempColor + ";";
      var compTargetStyle = compTargetPill
        ? compTargetPill
        : "color:" + targetTempColor + ";";

      var compactFriendlyName = this._escapeHtml(s.friendlyName);
      var compactHtml = [
        "<ha-card>",
        "<style>",
        this._buildStyles(accentColor),
        "</style>",
        '<div class="card-content">',
        '<div class="compact-row" id="compact-expand">',
        '<div class="compact-left">',
        '<span class="compact-name">' + compactFriendlyName + "</span>",
        compactBadge,
        "</div>",
        '<div class="compact-temps">',
        '<span class="compact-current" style="' + compCurrentStyle + '">' + compCurrentStr + '<span class="unit">\u00B0C</span></span>',
        '<span class="compact-target">\u2192 <span class="val" style="' + compTargetStyle + '">' + compTargetStr + '</span><span class="unit">\u00B0C</span></span>',
        "</div>",
        "</div>",
        "</div>",
        "</ha-card>",
      ].join("\n");

      this.shadowRoot.innerHTML = compactHtml;
      var self = this;
      var expandBtn = this.shadowRoot.getElementById("compact-expand");
      if (expandBtn) expandBtn.addEventListener("click", function () { self._toggleExpanded(); });
      return;
    }

    // Badge
    var badgeHtml;
    if (isOff) {
      badgeHtml = '<span class="mode-badge off">Off</span>';
    } else if (isPerm) {
      badgeHtml = '<span class="mode-badge permanent">Permanent</span>';
    } else if (isOver) {
      badgeHtml = '<span class="mode-badge override">Override</span>';
    } else {
      badgeHtml = '<span class="mode-badge schedule">Schedule</span>';
    }

    // HVAC toggle
    var hvacHtml = "";
    if (this._config.show_hvac_toggle) {
      var hvacLabel = isOff ? "Turn on" : "Turn off";
      hvacHtml = '<button class="hvac-toggle" id="hvac-toggle">' + hvacLabel + "</button>";
    }

    // Faults
    var faultsHtml = "";
    if (hasFaults) {
      var faultTexts = [];
      for (var i = 0; i < s.activeFaults.length; i++) {
        faultTexts.push(this._escapeHtml(s.activeFaults[i].faultType || "Fault detected"));
      }
      faultsHtml =
        '<div class="faults"><span>\u26A0</span><span>' +
        faultTexts.join(", ") +
        "</span></div>";
    }

    // Temps
    var currentTempStr = s.currentTemp !== null && s.currentTemp !== undefined
      ? s.currentTemp.toFixed(1) : "\u2014";
    var targetTempStr = displayTemp !== null && displayTemp !== undefined
      ? displayTemp.toFixed(1) : "\u2014";

    // Pill styles
    var currentPillStyle = this._pillStyle(s.currentTemp);
    var targetPillStyle = this._pillStyle(displayTemp);

    var currentInlineStyle = currentPillStyle
      ? currentPillStyle
      : "color:" + currentTempColor + ";";
    var targetInlineStyle = targetPillStyle
      ? targetPillStyle
      : "color:" + targetTempColor + ";";

    // Schedule line
    var schedSpTemp = s.thisSpTemp !== undefined && s.thisSpTemp !== null
      ? s.thisSpTemp + "\u00B0" : "\u2014";
    var nextTime = this._formatTime(s.nextSpFrom);
    var nextDate = this._formatDate(s.nextSpFrom);
    var nextTemp = s.nextSpTemp !== undefined && s.nextSpTemp !== null
      ? s.nextSpTemp + "\u00B0" : "\u2014";

    var nextLabel = nextDate && nextDate !== "today" ? nextDate + " " + nextTime : nextTime;

    var scheduleLine = '<div class="schedule-line">' +
      '<span>' + schedSpTemp + '</span> scheduled \u00B7 next <span>' + nextLabel + '</span> \u2192 <span>' + nextTemp + '</span>' +
      '</div>';

    // Override info
    var overrideInfoHtml = "";
    if (isOver) {
      var overTarget = s.targetHeatTemp !== undefined ? s.targetHeatTemp + "\u00B0C" : "";
      var rightSide = "";
      var infoClass = isTemp ? "override-info temp" : "override-info perm";

      if (isTemp && remaining) {
        rightSide = '<span class="countdown">' + remaining + "</span>";
      } else if (isPerm) {
        rightSide = '<span class="countdown permanent">Permanent</span>';
      }

      overrideInfoHtml = '<div class="' + infoClass + '">';
      overrideInfoHtml += '<div class="override-row"><span>Override to ' + overTarget + "</span>" + rightSide + "</div>";

      if (isTemp && s.overrideUntil) {
        var untilDateStr = this._formatDate(s.overrideUntil);
        var untilLabel = "Until " + this._formatTime(s.overrideUntil);
        if (untilDateStr && untilDateStr !== "today") {
          untilLabel += " " + untilDateStr;
        }
        overrideInfoHtml += '<div class="override-detail">' + untilLabel + "</div>";
      }

      overrideInfoHtml += "</div>";
    }

    // Controls
    var showControls = this._dirty || isOver;
    var controlsClass = showControls ? "controls-panel visible" : "controls-panel hidden";

    // Duration
    var presets = [
      { label: "30m", mins: 30 },
      { label: "1h", mins: 60 },
      { label: "2h", mins: 120 },
      { label: "3h", mins: 180 },
    ];
    var isPreset = false;
    var durButtonsHtml = "";
    for (var p = 0; p < presets.length; p++) {
      var activeClass = this._durationMins === presets[p].mins && !this._showCustomDuration ? " active" : "";
      if (activeClass) isPreset = true;
      durButtonsHtml += '<button class="dur-btn' + activeClass + '" data-mins="' + presets[p].mins + '">' + presets[p].label + "</button>";
    }
    var customActiveClass = this._showCustomDuration || !isPreset ? " active" : "";
    durButtonsHtml += '<button class="dur-btn' + customActiveClass + '" id="custom-dur-btn">Custom</button>';

    var endTimeStr = this._durationToEndTime(this._durationMins);
    var durationHoursStr = Math.floor(this._durationMins / 60) + "h " + (this._durationMins % 60) + "m";

    var customHtml = "";
    if (this._showCustomDuration || !isPreset) {
      customHtml = '<div class="custom-duration">' +
        '<select id="custom-hours">' + this._buildHoursOptions() + "</select>" +
        '<span class="custom-duration-label">hrs</span>' +
        '<select id="custom-mins">' + this._buildMinsOptions() + "</select>" +
        '<span class="custom-duration-label">mins</span>' +
        "</div>";
    }

    var durationSectionHtml =
      '<div class="duration-section">' +
      '<span class="duration-label">Duration</span>' +
      '<div class="duration-buttons">' + durButtonsHtml + "</div>" +
      customHtml +
      '<div class="duration-end-time">' + durationHoursStr + " \u2192 until " + endTimeStr + "</div>" +
      "</div>";

    // Actions
    var actionsHtml;
    if (isOver && this._dirty) {
      actionsHtml =
        '<div class="actions">' +
        '<button class="btn btn-cancel" id="cancel-btn">Back to Schedule</button>' +
        '<button class="btn btn-override" id="apply-btn">Update Override</button>' +
        "</div>";
    } else if (isOver) {
      actionsHtml =
        '<div class="actions">' +
        '<button class="btn btn-cancel" id="cancel-btn">Back to Schedule</button>' +
        "</div>";
    } else if (this._dirty) {
      actionsHtml =
        '<div class="actions">' +
        '<button class="btn btn-override" id="apply-btn">Override</button>' +
        '<button class="btn btn-permanent" id="perm-btn">Permanent</button>' +
        "</div>";
    } else {
      actionsHtml = "";
    }

    var controlsInner = "";
    if (showControls) {
      if (this._dirty) {
        controlsInner = durationSectionHtml + actionsHtml;
      } else {
        controlsInner = actionsHtml;
      }
    }

    // Assemble
    var friendlyName = this._escapeHtml(s.friendlyName);
    var html = [
      "<ha-card>",
      loadingHtml,
      "<style>",
      this._buildStyles(accentColor),
      "</style>",
      '<div class="card-content">',
      '<div class="header">',
      '<div class="header-left">',
      '<span class="room-name">' + friendlyName + "</span>",
      badgeHtml,
      "</div>",
      hvacHtml,
      "</div>",
      faultsHtml,
      '<div class="temp-section">',
      '<div class="current-temp-block">',
      '<div class="current-temp-label">Current</div>',
      '<div class="current-temp" style="' + currentInlineStyle + '">' + currentTempStr + '<span class="unit">\u00B0C</span></div>',
      "</div>",
      '<div class="target-control">',
      '<button class="temp-btn down" id="temp-down">\u2212</button>',
      '<div class="target-temp-display">',
      '<div class="target-temp-label">Target</div>',
      '<div class="target-temp-value" style="' + targetInlineStyle + '">' + targetTempStr + '<span class="unit">\u00B0C</span></div>',
      "</div>",
      '<button class="temp-btn up" id="temp-up">+</button>',
      "</div>",
      "</div>",
      scheduleLine,
      overrideInfoHtml,
      '<div class="' + controlsClass + '">',
      controlsInner,
      "</div>",
      "</div>",
      "</ha-card>",
    ].join("\n");

    this.shadowRoot.innerHTML = html;

    // Bind events
    var self = this;
    var tempUp = this.shadowRoot.getElementById("temp-up");
    var tempDown = this.shadowRoot.getElementById("temp-down");
    var applyBtn = this.shadowRoot.getElementById("apply-btn");
    var permBtn = this.shadowRoot.getElementById("perm-btn");
    var cancelBtn = this.shadowRoot.getElementById("cancel-btn");
    var hvacBtn = this.shadowRoot.getElementById("hvac-toggle");
    var customDurBtn = this.shadowRoot.getElementById("custom-dur-btn");
    var customHoursEl = this.shadowRoot.getElementById("custom-hours");
    var customMinsEl = this.shadowRoot.getElementById("custom-mins");

    if (tempUp) tempUp.addEventListener("click", function () { self._handleTempChange(0.5); });
    if (tempDown) tempDown.addEventListener("click", function () { self._handleTempChange(-0.5); });
    if (applyBtn) applyBtn.addEventListener("click", function () { self._applyOverride(); });
    if (permBtn) permBtn.addEventListener("click", function () { self._applyPermanentOverride(); });
    if (cancelBtn) cancelBtn.addEventListener("click", function () { self._cancelOverride(); });
    if (hvacBtn) hvacBtn.addEventListener("click", function () { self._toggleHvac(); });

    if (customDurBtn) customDurBtn.addEventListener("click", function () { self._toggleCustomDuration(); });
    if (customHoursEl) customHoursEl.addEventListener("change", function (e) { self._handleCustomHours(e.target.value); });
    if (customMinsEl) customMinsEl.addEventListener("change", function (e) { self._handleCustomMins(e.target.value); });

    var durBtns = this.shadowRoot.querySelectorAll(".dur-btn[data-mins]");
    for (var d = 0; d < durBtns.length; d++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          self._setDuration(parseInt(btn.getAttribute("data-mins"), 10));
        });
      })(durBtns[d]);
    }

    this._startCountdown();
  }

  getCardSize() {
    if (this._config.compact && !this._expanded && !this._dirty && !this._loading) return 2;
    return 4;
  }
}

if (!customElements.get("evohome-cards")) {
  customElements.define("evohome-cards", EvohomeZoneCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "evohome-cards",
  name: "Evohome Cards",
  description: "Custom card for Honeywell Evohome heating zones with override controls.",
});
