use serde::{Deserialize, Serialize};

/// All geometry is stored in points. Units only change the inspector's display.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub schema_version: u32,
    pub preset: String,
    pub paper: String,
    pub width: f64,
    pub height: f64,
    pub landscape: bool,
    pub units: String,
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    pub linked_margins: bool,
    pub mirrored: bool,
    pub background: String,
    pub columns: u32,
    pub gutter: f64,
    pub rule: bool,
    pub rule_width: f64,
    pub rule_color: String,
    pub rule_inset_top: f64,
    pub rule_inset_bottom: f64,
    pub body_font: String,
    pub heading_font: String,
    pub font_size: f64,
    pub heading_scale: f64,
    pub leading: f64,
    pub paragraph_spacing: f64,
    pub indent: f64,
    pub justify: bool,
    pub text_color: String,
    pub heading_color: String,
    pub link_color: String,
    pub page_numbers: bool,
    pub header: String,
    pub footer: String,
    pub toc: bool,
    pub title: String,
    pub author: String,
    pub full_width_title: bool,
    pub code_size: f64,
    pub figure_spacing: f64,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: 1,
            preset: "Essay".into(),
            paper: "Letter".into(),
            width: 612.,
            height: 792.,
            landscape: false,
            units: "in".into(),
            margin_top: 54.,
            margin_bottom: 54.,
            margin_left: 58.,
            margin_right: 58.,
            linked_margins: false,
            mirrored: false,
            background: "#ffffff".into(),
            columns: 1,
            gutter: 18.,
            rule: false,
            rule_width: 0.5,
            rule_color: "#9a9a94".into(),
            rule_inset_top: 0.,
            rule_inset_bottom: 0.,
            body_font: "Georgia".into(),
            heading_font: "Georgia".into(),
            font_size: 11.,
            heading_scale: 1.25,
            leading: 0.65,
            paragraph_spacing: 7.,
            indent: 0.,
            justify: false,
            text_color: "#282b2d".into(),
            heading_color: "#283b44".into(),
            link_color: "#345b70".into(),
            page_numbers: true,
            header: String::new(),
            footer: String::new(),
            toc: false,
            title: String::new(),
            author: String::new(),
            full_width_title: true,
            code_size: 8.,
            figure_spacing: 10.,
        }
    }
}
impl Config {
    pub fn dimensions(&self) -> (f64, f64) {
        if self.landscape {
            (self.height, self.width)
        } else {
            (self.width, self.height)
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("This layout was created by a newer Folio version.".into());
        }
        let (w, h) = self.dimensions();
        let checks = [
            ("Page width", w, 144., 2880.),
            ("Page height", h, 144., 2880.),
            ("Top margin", self.margin_top, 12., 720.),
            ("Bottom margin", self.margin_bottom, 12., 720.),
            ("Left margin", self.margin_left, 12., 720.),
            ("Right margin", self.margin_right, 12., 720.),
            ("Gutter", self.gutter, 0., 144.),
            ("Rule thickness", self.rule_width, 0.1, 6.),
            ("Font size", self.font_size, 6., 48.),
            ("Heading scale", self.heading_scale, 1., 2.),
            ("Line spacing", self.leading, 0.1, 2.),
            ("Paragraph spacing", self.paragraph_spacing, 0., 72.),
            ("Indent", self.indent, 0., 72.),
            ("Rule top inset", self.rule_inset_top, 0., 720.),
            ("Rule bottom inset", self.rule_inset_bottom, 0., 720.),
            ("Code size", self.code_size, 5., 24.),
            ("Figure spacing", self.figure_spacing, 0., 72.),
        ];
        for (name, v, min, max) in checks {
            if !v.is_finite() || v < min || v > max {
                return Err(format!(
                    "{name} must be between {min} and {max} points (or the displayed equivalent)."
                ));
            }
        }
        if !(1..=6).contains(&self.columns) {
            return Err("Choose between 1 and 6 columns.".into());
        }
        let text_width = w - self.margin_left - self.margin_right;
        let col_width =
            (text_width - self.gutter * (self.columns - 1) as f64) / self.columns as f64;
        if col_width < 60. || col_width < self.font_size * 6. {
            return Err(
                "Columns are too narrow. Reduce columns, margins, font size, or gutter.".into(),
            );
        }
        if h - self.margin_top - self.margin_bottom < 100. {
            return Err("Margins leave too little space for text.".into());
        }
        if self.rule_inset_top + self.rule_inset_bottom >= h - self.margin_top - self.margin_bottom
        {
            return Err("Rule insets consume the entire text area.".into());
        }
        if self.columns > 1 && self.rule && self.gutter < self.rule_width + 4. {
            return Err("Increase the gutter to leave space around the vertical rule.".into());
        }
        for color in [
            &self.background,
            &self.rule_color,
            &self.text_color,
            &self.heading_color,
            &self.link_color,
        ] {
            if color.len() != 7
                || !color.starts_with('#')
                || !color[1..].bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("Colors must use #RRGGBB notation.".into());
            }
        }
        for s in [
            &self.body_font,
            &self.heading_font,
            &self.header,
            &self.footer,
            &self.title,
            &self.author,
            &self.preset,
        ] {
            if s.len() > 2048 {
                return Err("A formatting field is too long.".into());
            }
        }
        if !["in", "mm", "pt"].contains(&self.units.as_str()) {
            return Err("Unknown measurement unit.".into());
        }
        if !["Letter", "A4", "Legal", "A5", "Custom"].contains(&self.paper.as_str()) {
            return Err("Unknown paper size.".into());
        }
        Ok(())
    }
    pub fn from_json(source: &str) -> Result<Self, String> {
        let mut value: serde_json::Value =
            serde_json::from_str(source).map_err(|e| format!("Invalid layout JSON: {e}"))?;
        if value.get("schemaVersion").is_none() {
            value
                .as_object_mut()
                .ok_or("Layout must be a JSON object.")?
                .insert("schemaVersion".into(), 1.into());
        }
        let config: Self =
            serde_json::from_value(value).map_err(|e| format!("Invalid layout: {e}"))?;
        config.validate()?;
        Ok(config)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_migration() {
        let c = Config::from_json("{}").unwrap();
        assert_eq!(c, Config::default());
    }
    #[test]
    fn rejects_impossible_geometry() {
        let mut c = Config::default();
        c.columns = 7;
        assert!(c.validate().is_err());
        c.columns = 1;
        c.margin_left = 600.;
        assert!(c.validate().is_err());
    }
    #[test]
    fn rejects_newer_and_invalid_colors() {
        assert!(Config::from_json(r#"{"schemaVersion":2}"#).is_err());
        assert!(Config::from_json(r#"{"textColor":"red"}"#).is_err());
    }
}
