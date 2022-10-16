export function formatUnit(value, unit, fractionDigits = 2, exp = 1000) {
    const units = [
        {unit: "T", exp: Math.pow(exp, 4)},
        {unit: "G", exp: Math.pow(exp, 3)},
        {unit: "M", exp: Math.pow(exp, 2)},
        {unit: "K", exp: exp},
    ]

    let sizeUnit = "";
    for (let i = 0; i < units.length; i++) {
        if (value >= units[i].exp) {
            value /= units[i].exp;
            sizeUnit = units[i].unit;
            break;
        }
    }

    return `${value.toFixed(fractionDigits)} ${sizeUnit}${unit}`;
}