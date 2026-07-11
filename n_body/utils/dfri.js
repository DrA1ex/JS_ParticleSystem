import {DataSmoother} from "./smoother.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Chooses a stable, minimal DFRI span. The controller intentionally uses
 * asymmetric hysteresis: recurring shortages raise the span quickly, while a
 * lower value is only probed after a long safe period. A failed probe is
 * reverted immediately and makes the controller rely more on the upper tail
 * of recent step times instead of only the smoothed mean.
 */
export class AdaptiveDFRIPacingController {
    constructor({maxCount = Number.MAX_SAFE_INTEGER, initialTarget = 0} = {}) {
        this.maxCount = maxCount;
        this._samples = new Array(64);
        this._sampleIndex = 0;
        this._sampleCount = 0;
        this._selected = clamp(Math.ceil(Math.max(0, initialTarget) - 0.02), 0, maxCount);
        this._hasInitialEstimate = Number.isFinite(initialTarget) && initialTarget > 0;
        this._nominalTarget = Math.max(0, initialTarget);
        this._upperTarget = this._nominalTarget;
        this._robustTarget = this._nominalTarget;
        this._pressure = 0;
        this._safeSamples = 0;
        this._cooldownSamples = 0;
        this._probePrevious = null;
        this._probeSamplesLeft = 0;
        this._distrust = 0;
        this._shortageReported = false;
        this._shortages = 0;
        this._increases = 0;
        this._decreases = 0;
        this._failedProbes = 0;
    }

    get selectedFrames() { return this._selected; }

    beginCycle() {
        this._shortageReported = false;
    }

    reconfigure({maxCount = this.maxCount, initialTarget = this._nominalTarget} = {}) {
        this.maxCount = maxCount;
        this._selected = clamp(this._selected, 0, maxCount);
        this._nominalTarget = Math.max(0, initialTarget);
        this._recomputeTargets();
    }

    observe(rawTarget, nominalTarget) {
        if (!Number.isFinite(rawTarget) || !Number.isFinite(nominalTarget)) return;

        rawTarget = clamp(Math.max(0, rawTarget), 0, this.maxCount);
        this._nominalTarget = clamp(Math.max(0, nominalTarget), 0, this.maxCount);
        const firstSample = this._sampleCount === 0;
        this._samples[this._sampleIndex] = rawTarget;
        this._sampleIndex = (this._sampleIndex + 1) % this._samples.length;
        this._sampleCount = Math.min(this._samples.length, this._sampleCount + 1);
        this._recomputeTargets();

        if (firstSample && !this._hasInitialEstimate) {
            this._selected = clamp(Math.ceil(this._nominalTarget - 0.02), 0, this.maxCount);
            this._hasInitialEstimate = true;
        }

        const exceedsCurrent = rawTarget > this._selected + 0.10 || this._robustTarget > this._selected + 0.10;
        const safelyBelow = rawTarget < this._selected - 0.40 && this._robustTarget < this._selected - 0.25;

        if (exceedsCurrent) {
            this._pressure += rawTarget > this._selected + 1.1 ? 1.5 : 1;
            this._safeSamples = 0;
            this._distrust = clamp(this._distrust + 0.025, 0, 1);
        } else {
            this._pressure = Math.max(0, this._pressure - 0.75);
            this._safeSamples = safelyBelow ? this._safeSamples + 1 : Math.max(0, this._safeSamples - 1);
            if (this._safeSamples > 0 && this._safeSamples % 60 === 0) {
                this._distrust = Math.max(0, this._distrust - 0.05);
                this._recomputeTargets();
            }
        }

        if (this._cooldownSamples > 0) this._cooldownSamples -= 1;
        if (this._probeSamplesLeft > 0) {
            this._probeSamplesLeft -= 1;
            if (this._probeSamplesLeft === 0) {
                this._probePrevious = null;
                this._cooldownSamples = Math.max(this._cooldownSamples, 30);
            }
        }

        if (this._pressure >= 3) {
            this._raise();
            return;
        }

        const lowerCandidate = clamp(Math.ceil(this._robustTarget - 0.02), 0, this.maxCount);
        if (this._cooldownSamples === 0 && this._probePrevious === null &&
            this._safeSamples >= 30 && lowerCandidate < this._selected) {
            this._probePrevious = this._selected;
            this._selected -= 1;
            this._probeSamplesLeft = 10;
            this._safeSamples = 0;
            this._decreases += 1;
        }
    }

    reportShortage() {
        if (this._shortageReported) return false;
        this._shortageReported = true;
        this._shortages += 1;
        this._safeSamples = 0;
        this._distrust = clamp(this._distrust + 0.22, 0, 1);
        this._pressure += 2;
        this._recomputeTargets();

        if (this._probePrevious !== null) {
            this._selected = clamp(this._probePrevious, 0, this.maxCount);
            this._probePrevious = null;
            this._probeSamplesLeft = 0;
            this._pressure = 0;
            this._cooldownSamples = 60;
            this._failedProbes += 1;
            this._increases += 1;
            return true;
        }

        if (this._pressure >= 3) {
            this._raise();
            return true;
        }
        return false;
    }

    diagnostics() {
        return {
            selectedFrames: this._selected,
            nominalTarget: this._nominalTarget,
            upperTarget: this._upperTarget,
            robustTarget: this._robustTarget,
            distrust: this._distrust,
            pressure: this._pressure,
            safeSamples: this._safeSamples,
            cooldownSamples: this._cooldownSamples,
            probingLower: this._probePrevious !== null,
            shortages: this._shortages,
            increases: this._increases,
            decreases: this._decreases,
            failedProbes: this._failedProbes,
            sampleCount: this._sampleCount,
        };
    }

    _raise() {
        const target = clamp(Math.ceil(this._robustTarget - 0.02), 0, this.maxCount);
        const next = Math.max(this._selected + 1, target);
        if (next > this._selected) {
            this._selected = clamp(next, 0, this.maxCount);
            this._increases += 1;
        }
        this._probePrevious = null;
        this._probeSamplesLeft = 0;
        this._pressure = 0;
        this._safeSamples = 0;
        this._cooldownSamples = 24;
    }

    _recomputeTargets() {
        if (this._sampleCount === 0) {
            this._upperTarget = this._nominalTarget;
            this._robustTarget = this._nominalTarget;
            return;
        }
        const values = this._samples.slice(0, this._sampleCount).sort((a, b) => a - b);
        const index = Math.min(values.length - 1, Math.floor((values.length - 1) * 0.85));
        this._upperTarget = values[index];
        this._robustTarget = clamp(
            this._nominalTarget + this._distrust * Math.max(0, this._upperTarget - this._nominalTarget),
            0,
            this.maxCount,
        );
    }
}
import {ITEM_SIZE, getParticleVelX, getParticleVelY, getParticleX, getParticleY} from "./particles.js";

export class DFRIHelperBase {

    constructor(renderer, particleCount) {
        this.renderer = renderer;
        this.particleCount = particleCount;

        this.frame = 0;
        this.interpolateFrames = 0;

        this._initialized = false;
        this._gpuInterpolation = false;
        this._deltas = null;
        this._recentRenderTimes = [];
        this._recentRenderTimeIndex = 0;
        this._recentRenderTimeCount = 0;
        this._recentBestRenderTime = 0;
    }

    /**
     * @abstract
     * @return {number}
     */
    get actualTime() {
        throw new Error("Not implemented");
    }

    /**
     * @abstract
     * @return {number}
     */
    get desiredTime() {
        throw new Error("Not implemented");
    }

    get maxCount() {
        return Number.MAX_SAFE_INTEGER;
    }

    get preferGpuInterpolation() {
        return false;
    }

    get usesGpuInterpolation() {
        return this._gpuInterpolation;
    }

    reconfigure() {}

    enable() {
        this._gpuInterpolation = this.preferGpuInterpolation && !!this.renderer.supportsGpuInterpolation?.();
        this.renderer.setInterpolationFrame?.(null);
        this.renderer.setInterpolationFactor?.(0);
        if (this._gpuInterpolation) {
            this.renderer.setCoordinateTransformer(null);
        } else {
            this._ensureDeltas();
            this.renderer.setCoordinateTransformer(this._transformParticlePosition.bind(this));
        }
    }

    disable() {
        this._gpuInterpolation = false;
        this.frame = 0;
        this.interpolateFrames = 0;
        this._currentFactor = 0;
        this.renderer.setCoordinateTransformer(null);
        this.renderer.setInterpolationFrame?.(null);
        this.renderer.setInterpolationFactor?.(0);
    }

    init() {
        this.interpolateFrames = this._getInterpolateFramesCount();
        this._initialized = true;
    }

    render(particles, pause = false) {
        if (!this._initialized) {
            this.init();
        }

        this._currentFactor = this.getFactor();
        if (this._gpuInterpolation) {
            this.renderer.setInterpolationFactor(this._currentFactor);
        }
        this.renderer.render(particles);

        if (!pause) {
            this.frame += 1;
        }
    }

    getFactor() {
        if (this.frame === 0) {
            return 0;
        } else if (this.frame > this.interpolateFrames) {
            const additionalFrames = this.frame - this.interpolateFrames + 1;
            return this.frame / (this.interpolateFrames + additionalFrames);
        }

        return this.frame / (this.interpolateFrames + 1);
    }

    needNextFrame() {
        return this.frame === 0 || this.frame > this.interpolateFrames;
    }

    reset() {
        this.frame = 0;
        this.interpolateFrames = this._getInterpolateFramesCount();
    }

    get targetRenderTime() {
        return this.desiredTime;
    }

    setNextFrame(dataFn) {
        this._ensureDeltas();
        const out = {x: 0, y: 0};
        for (let i = 0; i < this.particleCount; i++) {
            dataFn(i, out);
            const offset = i * 2;
            this._deltas[offset] = out.x;
            this._deltas[offset + 1] = out.y;
        }

        this.reset();
    }

    setNextPositionFrame(positions) {
        if (!this._gpuInterpolation || !positions) {
            return false;
        }
        this.renderer.setInterpolationPositionFrame?.(positions);
        this.reset();
        return true;
    }

    _ensureDeltas() {
        const required = this.particleCount * 2;
        if (this._deltas && this._deltas.length === required) {
            return;
        }

        // Keep CPU interpolation compact. Large recordings can contain millions
        // of particles, so allocating one JS object per delta is prohibitive.
        this._deltas = new Float32Array(required);
    }

    _getInterpolateFramesCount() {
        const interpolate = this.actualTime / this.desiredTime - 1;
        return Math.max(0, Math.min(this.maxCount, Math.ceil(interpolate)));
    }

    _transformParticlePosition(index, particle, out) {
        // Renderers pass particle objects in the legacy path and pre-filled
        // positions in the flat-buffer path. Read from whichever is available.
        const x = particle ? particle.x : out.x;
        const y = particle ? particle.y : out.y;
        const offset = index * 2;
        out.x = x + this._deltas[offset] * this._currentFactor;
        out.y = y + this._deltas[offset + 1] * this._currentFactor;
    }
}

export class SimpleDFRIHelper extends DFRIHelperBase {
    constructor(renderer, particlesCount, sourceFrameRate, desiredFramerate) {
        super(renderer, particlesCount);

        this.reconfigure(sourceFrameRate, desiredFramerate);
    }

    get preferGpuInterpolation() {
        return true;
    }

    get actualTime() {
        return this._actualTime;
    }

    get desiredTime() {
        return this._desiredTime;
    }

    reconfigure(sourceFrameRate, desiredFramerate) {
        this._actualTime = 1000 / sourceFrameRate;
        this._desiredTime = 1000 / desiredFramerate;
    }
}

export class DFRIHelper extends DFRIHelperBase {
    /**
     * @param {RendererBase} renderer
     * @param {AppSimulationSettings} settings
     */
    constructor(renderer, settings) {
        super(renderer, settings.physics.particleCount)

        this.settings = settings;

        this.stepTimeSmoother = new DataSmoother(this.settings.world.fps * 4, 1);
        this.renderTimeSmoother = new DataSmoother(this.settings.world.fps * 2, 5, true);
        this.renderTimeSmoother.postValue(1000 / this.settings.world.fps, true);

        const initialTarget = this._getContinuousTarget();
        this.pacingController = new AdaptiveDFRIPacingController({
            maxCount: this.maxCount,
            initialTarget,
        });
    }

    get preferGpuInterpolation() {
        return true;
    }

    get actualTime() {
        return this.stepTimeSmoother.smoothedValue;
    }

    get desiredTime() {
        const smoothed = this.renderTimeSmoother.smoothedValue || 1000 / this.settings.world.fps;
        const recentBest = this._recentBestRenderTime || smoothed;
        return Math.max(1, Math.min(smoothed, recentBest));
    }

    get maxCount() {
        return this.settings.render.DFRIMaxFrames;
    }

    bufferSwitched(particles, aheadBufferEntry) {
        const buffer = aheadBufferEntry?.buffer;

        if (this._gpuInterpolation) {
            // GPU DFRI cannot synthesize a velocity-based fallback in the shader.
            // If the real ahead frame is not ready yet, use the current frame as
            // a zero-delta placeholder and replace it later from updateAheadFrame().
            // This keeps the interpolation program in a valid state and avoids a
            // long "off" period on slower backends such as GPGPU.
            this.renderer.setInterpolationFrame(buffer || particles || null);
            this.reset();
            return;
        }

        this.setNextFrame((i, out) => {
            out.x = buffer ? buffer[i * ITEM_SIZE] - getParticleX(particles, i) : getParticleVelX(particles, i);
            out.y = buffer ? buffer[i * ITEM_SIZE + 1] - getParticleY(particles, i) : getParticleVelY(particles, i);
        });
    }

    updateAheadFrame(_particles, aheadBufferEntry) {
        if (!this._gpuInterpolation) {
            return false;
        }

        const buffer = aheadBufferEntry?.buffer;
        if (!buffer) {
            return false;
        }

        this.renderer.setInterpolationFrame(buffer);
        return true;
    }

    postStepTime(time, force = false) {
        this.stepTimeSmoother.postValue(time, force);
        const rawTarget = this._getContinuousTarget(time);
        const nominalTarget = this._getContinuousTarget(this.actualTime);
        this.pacingController.observe(rawTarget, nominalTarget);
    }

    reportAheadBufferMiss() {
        return this.pacingController.reportShortage();
    }

    get pacingDiagnostics() {
        return this.pacingController.diagnostics();
    }

    postRenderTime(time) {
        if (!Number.isFinite(time) || time <= 0 || time > 1000) {
            return;
        }

        this.renderTimeSmoother.postValue(time);
        this._postRecentRenderTime(time);
    }

    _postRecentRenderTime(time) {
        const maxSamples = Math.max(10, Math.min(240, this.settings.world.fps * 2));
        if (this._recentRenderTimes.length !== maxSamples) {
            this._recentRenderTimes = new Array(maxSamples);
            this._recentRenderTimeIndex = 0;
            this._recentRenderTimeCount = 0;
        }

        this._recentRenderTimes[this._recentRenderTimeIndex] = time;
        this._recentRenderTimeIndex = (this._recentRenderTimeIndex + 1) % maxSamples;
        this._recentRenderTimeCount = Math.min(maxSamples, this._recentRenderTimeCount + 1);

        let best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < this._recentRenderTimeCount; i++) {
            const value = this._recentRenderTimes[i];
            if (Number.isFinite(value) && value > 1 && value < best) {
                best = value;
            }
        }

        if (Number.isFinite(best)) {
            this._recentBestRenderTime = best;
        }
    }

    reconfigure(settings) {
        this.settings = settings;
        this._recentRenderTimes = [];
        this._recentRenderTimeIndex = 0;
        this._recentRenderTimeCount = 0;
        this._recentBestRenderTime = 0;
        this.pacingController = new AdaptiveDFRIPacingController({
            maxCount: this.maxCount,
            initialTarget: this._getContinuousTarget(),
        });
    }

    reset() {
        this.pacingController.beginCycle();
        super.reset();
    }

    _getContinuousTarget(stepTime = this.actualTime) {
        const desired = this.desiredTime;
        if (!Number.isFinite(stepTime) || stepTime <= 0 || !Number.isFinite(desired) || desired <= 0) {
            return 0;
        }
        return Math.max(0, stepTime / desired / this.settings.render.slowMotionRate - 1);
    }

    _getInterpolateFramesCount() {
        return clamp(this.pacingController?.selectedFrames ?? Math.ceil(this._getContinuousTarget() - 0.02), 0, this.maxCount);
    }

    dispose() {
        this.disable();
        this.renderer = null;
        this._deltas = null;
    }
}