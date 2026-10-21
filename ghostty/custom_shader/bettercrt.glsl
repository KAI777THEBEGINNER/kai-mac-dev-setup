// Enhanced CRT Shader for Ghostty
// Modified for stronger cathode-ray tube texture and retro authenticity

float warp = 0.12375; // 屏幕弯曲程度 (原 0.165 的 75%)
float scan = 0.35; // 扫描线对比度 (之前只有 0.05，太弱了)
float aberration_strength = 0.000525; // RGB 色差分离强度 (模拟荧光粉溢出，原 0.00105 的 50%)
float noise_intensity = 0.04; // 动态雪花噪点强度 (之前被设为 0 了)
float feather_edge = 0.012; // 屏幕边缘的柔和度（原 0.03，太宽了，会把边缘的文字一起压暗）

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    // 归一化坐标
    vec2 uv = fragCoord / iResolution.xy;
    vec2 orig_uv = uv;
    vec2 dc = abs(0.5 - uv);
    dc *= dc;

    // 先保存原始颜色（含 alpha），使用未畸变坐标
    vec4 originalColor = texture(iChannel0, orig_uv);

    // 弯曲坐标 (桶形畸变)
    uv.x -= 0.5; uv.x *= 1.0 + (dc.y * (0.3 * warp)); uv.x += 0.5;
    uv.y -= 0.5; uv.y *= 1.0 + (dc.x * (0.4 * warp)); uv.y += 0.5;

    // 屏幕边界检测：如果畸变后超出了屏幕范围，直接输出黑色并终止
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        fragColor = vec4(0.0, 0.0, 0.0, originalColor.a);
        return;
    }

    // 色差特效 - 分离采样 RGB 通道，保留原始 alpha
    vec3 color;
    color.r = texture(iChannel0, uv + vec2(aberration_strength, 0.0)).r;
    color.g = texture(iChannel0, uv).g;
    color.b = texture(iChannel0, uv - vec2(aberration_strength, 0.0)).b;

    // 扫描线特效 - 频率根据屏幕高度自适应
    float scanlines_freq = iResolution.y * 0.6; 
    float scanline_effect = 0.5 + 0.5 * sin(orig_uv.y * scanlines_freq);
    scanline_effect = smoothstep(0.3, 0.7, scanline_effect); 
    // 让扫描线能真正压暗画面（修改了原来 0.95 的下限）
    color *= mix(vec3(1.0), vec3(0.65), scanline_effect * scan);

    // 动态噪点 (模拟电子管底噪)
    float noise_time = iTime * 100.0;
    float x = (orig_uv.x - mod(orig_uv.x, 0.003)) * (orig_uv.y - mod(orig_uv.y, 0.002)) * noise_time;
    x = mod(x, 13.0) * mod(x, 123.0);
    float noise = mod(x, 0.2) / 0.2;
    color = mix(color, vec3(noise), noise_intensity);

    // 边缘羽化
    vec2 edge_dist = abs(uv * 2.0 - 1.0);
    float edge_mask = (1.0 - smoothstep(1.0 - feather_edge, 1.0, edge_dist.x)) *
                      (1.0 - smoothstep(1.0 - feather_edge, 1.0, edge_dist.y));

    // 暗角特效 (Vignette) - 只压四角，不再压到正文区域
    // 原式 1 - dc.x*dc.y*12 配合下限 0.6，会让四周约 8% 的范围整片暗 40%，盖住文字
    float vignette = 1.0 - pow(clamp(dc.x * dc.y * 8.0, 0.0, 1.0), 1.6);
    color *= clamp(vignette, 0.85, 1.0);

    // 亮度/对比度微调，补偿扫描线和暗角带来的亮度损失
    color = (color - 0.5) * 1.08 + 0.58; 

    fragColor = vec4(color * edge_mask, originalColor.a);
}