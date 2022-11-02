import {AppSimulationSettings} from "../settings/app.js";
import {PropertyType} from "../settings/base.js";
import * as EnumUtils from "../utils/enum.js";

const T = AppSimulationSettings;

export default function () {
    const result = [];

    for (const category of Object.values(T.Types)) {
        result.push(`### ${category.name} category`);

        for (const property of Object.values(category.type.Properties)) {
            result.push(`#### ${property.name} - \`${property.key}\``);

            let defaultValue = property.defaultValue;
            if (defaultValue !== null && property.type === PropertyType.enum) {
                defaultValue = EnumUtils.findKey(property.enumType, defaultValue);
            }

            const description = [
                property.descriptionText && `\n _${property.descriptionText}_\n`,
                defaultValue !== null && `> - default: **${defaultValue}**`,
                property.type && `> - type: **${property.type}**`,
                (property.min !== null || property.max !== null) && `> - constraints: **${property.min ?? '-∞'}-${property.max ?? "∞"}**`,
                property.type === PropertyType.enum && `> - values: ${Object.keys(property.enumType).map(v => `**${v}**`).join(", ")}`
            ];

            result.push(...description.filter(v => v));
        }
    }

    return result.join("\n");
}