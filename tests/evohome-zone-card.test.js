import { beforeEach, describe, expect, it, vi } from "vitest";

import "../evohome-zone-card.js";

function makeState(overrides = {}) {
  return {
    state: "heat",
    attributes: {
      friendly_name: "Living Room",
      current_temperature: 20,
      temperature: 21,
      min_temp: 5,
      max_temp: 35,
      status: {
        setpoints: {
          this_sp_from: "2026-02-27T10:00:00Z",
          this_sp_temp: 21,
          next_sp_from: "2026-02-27T11:00:00Z",
          next_sp_temp: 19,
        },
        setpoint_status: {
          setpoint_mode: "FollowSchedule",
          target_heat_temperature: 21,
          until: null,
        },
        activeFaults: [],
      },
    },
    ...overrides,
  };
}

function makeHass(state) {
  return {
    states: {
      "climate.living_room": state,
    },
    callService: vi.fn().mockResolvedValue(undefined),
  };
}

function createCard(state, config = { entity: "climate.living_room" }) {
  const card = document.createElement("evohome-zone-card");
  card.setConfig(config);
  if (state) card.hass = makeHass(state);
  return card;
}

describe("evohome-zone-card", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders with configured entity", () => {
    const card = document.createElement("evohome-zone-card");
    card.setConfig({ entity: "climate.living_room" });
    card.hass = makeHass(makeState());

    expect(card.shadowRoot.innerHTML).toContain("Living Room");
    expect(card.shadowRoot.innerHTML).toContain("Schedule");
  });

  it("escapes friendly name HTML", () => {
    const card = document.createElement("evohome-zone-card");
    card.setConfig({ entity: "climate.living_room" });

    const badName = '<img src=x onerror="alert(1)">';
    const state = makeState({
      attributes: {
        ...makeState().attributes,
        friendly_name: badName,
      },
    });

    card.hass = makeHass(state);

    const roomName = card.shadowRoot.querySelector(".room-name");
    expect(roomName.textContent).toBe(badName);
    expect(card.shadowRoot.querySelector(".room-name img")).toBeNull();
  });

  it("clears loading state when service call fails", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const card = createCard(makeState());
    const hass = makeHass(makeState());
    hass.callService = vi.fn().mockRejectedValue(new Error("boom"));
    card.hass = hass;

    card._handleTempChange(0.5);
    card._applyOverride();

    await Promise.resolve();

    expect(card._loading).toBe(false);
    consoleErr.mockRestore();
  });

  it("preserves local draft when hass state updates", () => {
    const card = createCard(makeState());

    card._handleTempChange(0.5);
    expect(card._dirty).toBe(true);
    expect(card._localTemp).toBe(21.5);

    const nextState = makeState({
      attributes: {
        ...makeState().attributes,
        current_temperature: 20.2,
      },
    });
    card.hass = makeHass(nextState);

    expect(card._dirty).toBe(true);
    expect(card._localTemp).toBe(21.5);
  });

  it("keeps draft values when temporary override call fails", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const card = createCard(makeState());
    const hass = makeHass(makeState());
    hass.callService = vi.fn().mockRejectedValue(new Error("boom"));
    card.hass = hass;

    card._setDuration(125);
    card._handleTempChange(0.5);
    card._applyOverride();

    await Promise.resolve();

    expect(card._loading).toBe(false);
    expect(card._dirty).toBe(true);
    expect(card._localTemp).toBe(21.5);
    expect(card._durationMins).toBe(125);
    consoleErr.mockRestore();
  });

  it("calls temporary override with expected payload", () => {
    const card = createCard(makeState());
    card._setDuration(125);
    card._handleTempChange(0.5);
    card._applyOverride();

    expect(card._hass.callService).toHaveBeenCalledWith("evohome", "set_zone_override", {
      entity_id: "climate.living_room",
      setpoint: 21.5,
      duration: {
        hours: 2,
        minutes: 5,
      },
    });
  });

  it("calls permanent override with expected payload", () => {
    const card = createCard(makeState());
    card._handleTempChange(1);
    card._applyPermanentOverride();

    expect(card._hass.callService).toHaveBeenCalledWith("evohome", "set_zone_override", {
      entity_id: "climate.living_room",
      setpoint: 22,
    });
  });

  it("calls cancel override service", () => {
    const state = makeState({
      attributes: {
        ...makeState().attributes,
        status: {
          ...makeState().attributes.status,
          setpoint_status: {
            setpoint_mode: "TemporaryOverride",
            target_heat_temperature: 22,
            until: "2026-02-27T12:00:00Z",
          },
        },
      },
    });
    const card = createCard(state);
    card._cancelOverride();

    expect(card._hass.callService).toHaveBeenCalledWith("evohome", "clear_zone_override", {
      entity_id: "climate.living_room",
    });
  });

  it("calls HVAC toggle with expected mode", () => {
    const card = createCard(makeState({ state: "heat" }));
    card._toggleHvac();

    expect(card._hass.callService).toHaveBeenCalledWith("climate", "set_hvac_mode", {
      entity_id: "climate.living_room",
      hvac_mode: "off",
    });
  });

  it("handles missing new state in hass update without throwing", () => {
    const card = createCard(makeState());
    card._startLoading("TemporaryOverride");

    const nextHass = {
      states: {},
      callService: vi.fn(),
    };

    expect(() => {
      card.hass = nextHass;
    }).not.toThrow();
  });

  it("escapes fault text HTML", () => {
    const badFault = '<img src=x onerror="alert(1)">';
    const state = makeState({
      attributes: {
        ...makeState().attributes,
        status: {
          ...makeState().attributes.status,
          activeFaults: [{ faultType: badFault }],
        },
      },
    });
    const card = createCard(state);

    const faults = card.shadowRoot.querySelector(".faults");
    expect(faults.textContent).toContain(badFault);
    expect(card.shadowRoot.querySelector(".faults img")).toBeNull();
  });

  it("uses compact card size only when compact view is actually rendered", () => {
    const card = createCard(makeState(), { entity: "climate.living_room", compact: true });

    expect(card.getCardSize()).toBe(2);

    card._handleTempChange(0.5);
    expect(card.getCardSize()).toBe(4);

    card._dirty = false;
    card._loading = true;
    expect(card.getCardSize()).toBe(4);

    card._loading = false;
    card._expanded = true;
    expect(card.getCardSize()).toBe(4);
  });

  it("reacts to hass updates and refreshes rendered state", () => {
    const card = createCard(makeState());
    expect(card.shadowRoot.innerHTML).toContain("Schedule");

    const overrideState = makeState({
      attributes: {
        ...makeState().attributes,
        current_temperature: 22,
        status: {
          ...makeState().attributes.status,
          setpoint_status: {
            setpoint_mode: "TemporaryOverride",
            target_heat_temperature: 23,
            until: "2026-02-27T12:00:00Z",
          },
        },
      },
    });

    card.hass = makeHass(overrideState);

    expect(card.shadowRoot.innerHTML).toContain("Override");
    expect(card.shadowRoot.innerHTML).toContain("22.0");
    expect(card.shadowRoot.innerHTML).toContain("23.0");
  });

  it("wires key click interactions through rendered controls", () => {
    const card = createCard(makeState(), {
      entity: "climate.living_room",
      compact: true,
    });

    const expand = card.shadowRoot.getElementById("compact-expand");
    expect(expand).not.toBeNull();
    expand.click();
    expect(card._expanded).toBe(true);

    const hvacSpy = vi.spyOn(card, "_toggleHvac");
    const hvacBtn = card.shadowRoot.getElementById("hvac-toggle");
    expect(hvacBtn).not.toBeNull();
    hvacBtn.click();
    expect(hvacSpy).toHaveBeenCalledTimes(1);

    const tempUp = card.shadowRoot.getElementById("temp-up");
    expect(tempUp).not.toBeNull();
    tempUp.click();
    expect(card._dirty).toBe(true);
    expect(card._localTemp).toBe(21.5);

    const customDurBtn = card.shadowRoot.getElementById("custom-dur-btn");
    expect(customDurBtn).not.toBeNull();
    customDurBtn.click();
    expect(card._showCustomDuration).toBe(true);

    const customHours = card.shadowRoot.getElementById("custom-hours");
    expect(customHours).not.toBeNull();
    customHours.value = "2";
    customHours.dispatchEvent(new Event("change"));
    expect(card._durationMins).toBe(120);
  });

  it("renders safely with partial status attributes", () => {
    const sparseState = makeState({
      attributes: {
        ...makeState().attributes,
        current_temperature: null,
        status: {},
      },
    });

    const card = createCard(sparseState);

    expect(card.shadowRoot.innerHTML).toContain("Living Room");
    expect(card.shadowRoot.innerHTML).toContain("Schedule");
    expect(card.shadowRoot.innerHTML).toContain("\u2014");
    expect(card.shadowRoot.innerHTML).not.toContain("undefined");
    expect(card.shadowRoot.innerHTML).not.toContain("null");
  });

  it("validates config entity and applies default/override flags", () => {
    const missingEntityCard = document.createElement("evohome-zone-card");
    expect(() => missingEntityCard.setConfig({})).toThrow();

    const defaultCard = document.createElement("evohome-zone-card");
    defaultCard.setConfig({ entity: "climate.living_room" });
    expect(defaultCard._config.show_hvac_toggle).toBe(true);
    expect(defaultCard._config.show_accent_bar).toBe(true);
    expect(defaultCard._config.temp_pills).toBe(false);
    expect(defaultCard._config.compact).toBe(false);

    const overrideCard = document.createElement("evohome-zone-card");
    overrideCard.setConfig({
      entity: "climate.living_room",
      show_hvac_toggle: false,
      show_accent_bar: false,
      temp_pills: true,
      compact: true,
    });
    expect(overrideCard._config.show_hvac_toggle).toBe(false);
    expect(overrideCard._config.show_accent_bar).toBe(false);
    expect(overrideCard._config.temp_pills).toBe(true);
    expect(overrideCard._config.compact).toBe(true);
  });

  it("renders not-found state and recovers when entity appears", () => {
    const card = document.createElement("evohome-zone-card");
    card.setConfig({ entity: "climate.living_room" });
    card.hass = { states: {}, callService: vi.fn() };
    expect(card.shadowRoot.innerHTML).toContain("Entity not found: climate.living_room");

    card.hass = makeHass(makeState());
    expect(card.shadowRoot.innerHTML).toContain("Living Room");
  });

  it("clears loading via timeout and expected-mode hass update", () => {
    vi.useFakeTimers();
    try {
      const card = createCard(makeState());

      card._startLoading("TemporaryOverride");
      expect(card._loading).toBe(true);
      vi.advanceTimersByTime(30000);
      expect(card._loading).toBe(false);

      card._startLoading("TemporaryOverride");
      const matchedState = makeState({
        attributes: {
          ...makeState().attributes,
          status: {
            ...makeState().attributes.status,
            setpoint_status: {
              setpoint_mode: "TemporaryOverride",
              target_heat_temperature: 22,
              until: "2026-02-27T12:00:00Z",
            },
          },
        },
      });
      card.hass = makeHass(matchedState);
      expect(card._loading).toBe(false);
      expect(card._expectedMode).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears timers on disconnected callback", () => {
    vi.useFakeTimers();
    try {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      const card = createCard(makeState());

      card._startLoading("TemporaryOverride");
      card._startCountdown();

      const timeoutId = card._loadingTimeout;
      const intervalId = card._countdownInterval;

      card.disconnectedCallback();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
      expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);

      clearTimeoutSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps draft values when permanent override call fails", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const card = createCard(makeState());
    const hass = makeHass(makeState());
    hass.callService = vi.fn().mockRejectedValue(new Error("boom"));
    card.hass = hass;

    card._handleTempChange(1);
    card._applyPermanentOverride();
    await Promise.resolve();

    expect(card._loading).toBe(false);
    expect(card._dirty).toBe(true);
    expect(card._localTemp).toBe(22);
    consoleErr.mockRestore();
  });

  it("clears loading on hvac and cancel failures", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const hvacCard = createCard(makeState());
    hvacCard._hass.callService = vi.fn().mockRejectedValue(new Error("boom"));

    hvacCard._toggleHvac();
    await Promise.resolve();
    expect(hvacCard._loading).toBe(false);
    expect(hvacCard.shadowRoot.getElementById("hvac-toggle")).not.toBeNull();

    const overrideState = makeState({
      attributes: {
        ...makeState().attributes,
        status: {
          ...makeState().attributes.status,
          setpoint_status: {
            setpoint_mode: "TemporaryOverride",
            target_heat_temperature: 22,
            until: "2026-02-27T12:00:00Z",
          },
        },
      },
    });
    const cancelCard = createCard(overrideState);
    cancelCard._hass.callService = vi.fn().mockRejectedValue(new Error("boom"));
    cancelCard._cancelOverride();
    await Promise.resolve();
    expect(cancelCard._loading).toBe(false);
    expect(cancelCard.shadowRoot.getElementById("cancel-btn")).not.toBeNull();
    consoleErr.mockRestore();
  });

  it("renders correct action buttons for each mode/state combination", () => {
    const scheduleCard = createCard(makeState());
    expect(scheduleCard.shadowRoot.getElementById("apply-btn")).toBeNull();
    expect(scheduleCard.shadowRoot.getElementById("perm-btn")).toBeNull();
    expect(scheduleCard.shadowRoot.getElementById("cancel-btn")).toBeNull();

    scheduleCard._handleTempChange(0.5);
    expect(scheduleCard.shadowRoot.getElementById("apply-btn")).not.toBeNull();
    expect(scheduleCard.shadowRoot.getElementById("perm-btn")).not.toBeNull();
    expect(scheduleCard.shadowRoot.getElementById("cancel-btn")).toBeNull();

    const overrideState = makeState({
      attributes: {
        ...makeState().attributes,
        status: {
          ...makeState().attributes.status,
          setpoint_status: {
            setpoint_mode: "TemporaryOverride",
            target_heat_temperature: 22,
            until: "2026-02-27T12:00:00Z",
          },
        },
      },
    });
    const overrideCard = createCard(overrideState);
    expect(overrideCard.shadowRoot.getElementById("cancel-btn")).not.toBeNull();
    expect(overrideCard.shadowRoot.getElementById("apply-btn")).toBeNull();
    expect(overrideCard.shadowRoot.getElementById("perm-btn")).toBeNull();

    overrideCard._handleTempChange(0.5);
    expect(overrideCard.shadowRoot.getElementById("cancel-btn")).not.toBeNull();
    expect(overrideCard.shadowRoot.getElementById("apply-btn")).not.toBeNull();
    expect(overrideCard.shadowRoot.getElementById("perm-btn")).toBeNull();
  });

  it("clamps custom duration to valid bounds", () => {
    const card = createCard(makeState());

    card._setDuration(30);
    card._handleCustomHours("30");
    expect(card._durationMins).toBe(1439);

    card._setDuration(1);
    card._handleCustomHours("0");
    card._handleCustomMins("0");
    expect(card._durationMins).toBe(1);

    card._setDuration(1380);
    card._handleCustomMins("59");
    expect(card._durationMins).toBe(1439);
  });
});
