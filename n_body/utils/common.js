function _formatUnit(value, unit, unitsConfig, fractionDigits) {
    let sizeUnit = "";
    for (let i = 0; i < unitsConfig.length; i++) {
        if (value >= unitsConfig[i].exp) {
            value /= unitsConfig[i].exp;
            sizeUnit = unitsConfig[i].unit;
            break;
        }
    }

    sizeUnit = formatUnitSuffix(fractionDigits > 0 ? value : Math.round(value), sizeUnit);
    return `${value.toFixed(fractionDigits)} ${sizeUnit}${unit}`;
}

export function formatUnitSuffix(value, unit) {
    if (unit instanceof Array) {
        if (Math.abs(value) === 1) {
            return unit[0];
        } else {
            return unit[1];
        }
    }

    return unit;
}

export function formatUnit(value, unit, fractionDigits = 2, exp = 1000) {
    const units = [
        {unit: "T", exp: Math.pow(exp, 4)},
        {unit: "G", exp: Math.pow(exp, 3)},
        {unit: "M", exp: Math.pow(exp, 2)},
        {unit: "K", exp: exp},
    ]

    return _formatUnit(value, unit, units, fractionDigits);
}

export function formatByteSize(size) {
    return formatUnit(size, "B", 2, 1024)
}

export function formatTimeSpan(ms, fractionDigits = 0) {
    const units = [
        {unit: ["day", "days"], exp: 60 * 60 * 24 * 1000},
        {unit: ["hour", "hours"], exp: 60 * 60 * 1000},
        {unit: ["minute", "minutes"], exp: 60 * 1000},
        {unit: ["second", "seconds"], exp: 1000},
        {unit: "ms", exp: 1},
    ]

    return _formatUnit(ms, "", units, fractionDigits);
}