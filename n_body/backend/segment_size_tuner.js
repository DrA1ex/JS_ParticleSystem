const SEGMENT_TUNE_CANDIDATES = [8, 16, 24, 32, 40, 48, 64, 96];
const SEGMENT_TUNE_SAMPLES_PER_CANDIDATE = 2;

/**
 * Small shared auto-tuner used by both CPU worker backends. The selected
 * candidate changes only between physics steps, so reported actualSize always
 * describes the tree that produced the current sample.
 */
export class SegmentSizeAutoTuner {
    constructor(settings) {
        this.enabled = !!settings.simulation.autoTuneSegmentSize;
        this.baseSize = settings.simulation.segmentMaxCount;
        this.particleCount = settings.physics.particleCount;
        this.candidates = this._buildCandidates(this.baseSize, this.particleCount);
        this.samplesPerCandidate = SEGMENT_TUNE_SAMPLES_PER_CANDIDATE;
        this.candidateIndex = 0;
        this.sampleIndex = 0;
        this.results = [];
        this.finished = !this.enabled || this.candidates.length <= 1;
        this.selectedSize = this.finished ? this.baseSize : this.candidates[0];
        this.lastStepTime = null;
        this.lastAverageTime = null;
    }

    get currentSize() {
        return this.finished ? this.selectedSize : this.candidates[this.candidateIndex];
    }

    record(stepTime) {
        if (!this.enabled || this.finished) {
            this.lastStepTime = stepTime;
            return;
        }

        const candidate = this.candidates[this.candidateIndex];
        let result = this.results[this.candidateIndex];
        if (!result) {
            result = {size: candidate, totalTime: 0, samples: 0, averageTime: null};
            this.results[this.candidateIndex] = result;
        }

        result.totalTime += stepTime;
        result.samples += 1;
        result.averageTime = result.totalTime / result.samples;
        this.lastStepTime = stepTime;
        this.lastAverageTime = result.averageTime;
        this.sampleIndex += 1;

        if (this.sampleIndex < this.samplesPerCandidate) {
            return;
        }

        this.sampleIndex = 0;
        this.candidateIndex += 1;
        if (this.candidateIndex >= this.candidates.length) {
            this._selectBest();
        }
    }

    _selectBest() {
        let best = this.results[0];
        for (let i = 1; i < this.results.length; i++) {
            const result = this.results[i];
            if (result && result.averageTime < best.averageTime) {
                best = result;
            }
        }

        this.selectedSize = best?.size ?? this.baseSize;
        this.lastAverageTime = best?.averageTime ?? null;
        this.finished = true;
    }

    _buildCandidates(baseSize, particleCount) {
        const maxCandidate = Math.max(1, Math.min(128, particleCount));
        const values = [...SEGMENT_TUNE_CANDIDATES, baseSize]
            .filter(value => Number.isFinite(value) && value >= 1 && value <= maxCandidate);
        return [...new Set(values)].sort((a, b) => a - b);
    }

    getStats(actualSize) {
        if (!this.enabled) {
            return {
                enabled: false,
                status: "off",
                actualSize,
                selectedSize: actualSize,
                candidateSize: actualSize,
                candidates: [],
                sample: 0,
                samplesPerCandidate: this.samplesPerCandidate,
                lastStepTime: this.lastStepTime,
                lastAverageTime: null,
            };
        }

        return {
            enabled: true,
            status: this.finished ? "done" : "tuning",
            actualSize,
            selectedSize: this.selectedSize,
            candidateSize: this.currentSize,
            candidates: this.candidates,
            sample: this.finished ? this.samplesPerCandidate : this.sampleIndex + 1,
            samplesPerCandidate: this.samplesPerCandidate,
            lastStepTime: this.lastStepTime,
            lastAverageTime: this.lastAverageTime,
        };
    }
}
