(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YouTubeDiscovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const split = (value) => String(value || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ');
  const hasTerm = (haystack, term) => normalize(haystack).includes(normalize(term));
  const STOP_WORDS = new Set(['i','me','my','we','our','want','wanna','like','love','show','find','watch','watching','video','videos','about','with','that','this','the','and','for','from','some','more','less','not','no','avoid','without','please','explain','explained','explanation']);
  function preferenceMatches(features, values) {
    return values.filter((value) => {
      if (hasTerm(features, value)) return true;
      const words = normalize(value).split(/\s+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
      return words.some((word) => hasTerm(features, word));
    });
  }
  function scoreVideo(video, prefs) {
    const labels = (video.labels || []).map((x) => x.toLowerCase());
    const features = (video.topics || []).join(' ') + ' ' + (video.formats || []).join(' ') + ' ' + (video.title || '') + ' ' + (video.description || '') + ' ' + (video.transcript || '');
    const likes = split(prefs.likes);
    const avoids = split(prefs.avoids);
    const exclusions = split(prefs.excludes);
    const strictMatches = exclusions.filter((item) => preferenceMatches(features, [item]).length > 0 || labels.some((label) => preferenceMatches(label, [item]).length > 0));
    const positiveMatches = preferenceMatches(features, likes);
    const negativeMatches = preferenceMatches(features, avoids);
    let score = 50 + positiveMatches.length * 12 - negativeMatches.length * 12;
    if (video.evidence === 'transcript') score += 3;
    if (video.evidence === 'limited') score -= 8;
    const patternPenalty = [];
    const toggles = [
      ['clickbait', prefs.avoidClickbait, 14],
      ['ragebait', prefs.avoidRagebait, 14],
      ['generic_advice', prefs.avoidGeneric, 12],
    ];
    for (const [label, enabled, penalty] of toggles) {
      if (enabled && labels.includes(label)) { score -= penalty; patternPenalty.push(label); }
    }
    for (const label of ['ai_slop', 'repetitive', 'low_substance']) {
      if (labels.includes(label) && negativeMatches.some((x) => hasTerm(x, label.replace('_', ' ')))) score -= 8;
    }
    score = Math.max(0, Math.min(100, score));
    const reasons = [];
    if (positiveMatches.length) reasons.push(`Matches your interests: ${positiveMatches.join(', ')}.`);
    if (negativeMatches.length) reasons.push(`Conflicts with preferences you asked to down-rank: ${negativeMatches.join(', ')}.`);
    if (patternPenalty.length) reasons.push(`Contains patterns you asked to avoid: ${patternPenalty.map((x) => x.replace('_', ' ')).join(', ')}.`);
    if (video.evidence === 'limited') reasons.push('Only title and description were available, so this match is less certain.');
    if (!positiveMatches.length && !negativeMatches.length) reasons.push('No direct preference match was found in the available video details.');
    if (strictMatches.length) reasons.unshift(`Filtered by strict exclusion: ${strictMatches.join(', ')}.`);
    return { score, blocked: strictMatches.length > 0, strictMatches, positiveMatches, negativeMatches, patternPenalty, explanation: reasons.join(' ') };
  }
  function evaluateHomeCard(video, prefs) {
    const score = scoreVideo(video, prefs);
    const flagged = (video.labels || []).filter((label) =>
      (label === 'ragebait' && prefs.avoidRagebait) ||
      (label === 'clickbait' && prefs.avoidClickbait) ||
      (label === 'generic_advice' && prefs.avoidGeneric)
    );
    const offTopic = video.evidence !== 'insufficient' && split(prefs.likes).length > 0 && score.positiveMatches.length === 0;
    const hide = Boolean(prefs.filterHome && (score.blocked || flagged.length > 0 || offTopic));
    return { hide, score, flagged, offTopic, reason: score.blocked ? `Excluded: ${score.strictMatches.join(', ')}` : flagged.length ? `Filtered: ${flagged.join(', ')}` : offTopic ? 'No direct match to your listed interests' : '' };
  }
  return { split, scoreVideo, evaluateHomeCard };
});

