(function(root){
  "use strict";
  const DAY_MS = 86400000;
  const ZONES = {"GMT+8":"Asia/Singapore", ET:"America/New_York"};
  function parseDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value ? date : null;
  }
  function dateISO(date){ return date.toISOString().slice(0,10); }
  function addDays(value, count){ return dateISO(new Date(parseDate(value).getTime() + count * DAY_MS)); }
  function monthStart(value){ return value.slice(0,7) + "-01"; }
  function shiftMonth(value, count){
    const date = parseDate(value), day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + count);
    const last = new Date(date.getTime());
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    date.setUTCDate(Math.min(day, last.getUTCDate()));
    return dateISO(date);
  }
  function calendarDays(value){
    const first = monthStart(value), date = parseDate(first);
    const offset = (date.getUTCDay() + 6) % 7;
    return Array.from({length:42}, (_, index)=>{
      const day = addDays(first, index - offset);
      return day.slice(0,7) === first.slice(0,7) ? day : "";
    });
  }
  function selectDate(range, date){
    if(!parseDate(date)) return {...range};
    if(!range.start || range.end) return {start:date, end:""};
    return date < range.start ? {start:date, end:range.start} : {start:range.start, end:date};
  }
  function todayInZone(timezone, now = new Date()){
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone:ZONES[timezone] || ZONES["GMT+8"], year:"numeric", month:"2-digit", day:"2-digit"
    }).formatToParts(now);
    const part = type=>parts.find(p=>p.type === type).value;
    return part("year") + "-" + part("month") + "-" + part("day");
  }
  const helpers = {parseDate, addDays, monthStart, shiftMonth, calendarDays, selectDate, todayInZone};
  if(typeof module !== "undefined" && module.exports) module.exports = helpers;
  if(!root.document) return;

  const document = root.document;
  const trigger = document.getElementById("dateRangeBtn");
  if(!trigger) return;
  const from = document.getElementById("dateFrom"), to = document.getElementById("dateTo");
  const label = document.getElementById("dateRangeLabel");
  const dialog = document.createElement("div");
  dialog.id = "dateRangeDialog";
  dialog.className = "dr-dialog";
  dialog.hidden = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-labelledby", "dateRangeTitle");
  dialog.setAttribute("aria-describedby", "dateRangeStatus");
  const icon = path=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
  dialog.innerHTML = '<div class="dr-topline"><span class="dr-title" id="dateRangeTitle">Date range</span><span class="dr-zone" id="dateRangeZone">GMT+8</span><button type="button" class="dr-close" aria-label="Close calendar">' + icon('m6 6 12 12M6 18 18 6') + '</button></div>'
    + '<div class="dr-selection"><div class="dr-selection-box" data-endpoint="start"><span class="dr-selection-caption">Start date</span><span class="dr-selection-value"></span></div>'
    + '<svg class="dr-selection-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>'
    + '<div class="dr-selection-box" data-endpoint="end"><span class="dr-selection-caption">End date</span><span class="dr-selection-value"></span></div></div>'
    + '<div class="dr-months"></div><div class="dr-footer"><button type="button" class="dr-clear">Clear</button><span class="dr-status" id="dateRangeStatus" aria-live="polite"></span><button type="button" class="dr-apply">Apply</button></div>';
  document.body.appendChild(dialog);
  const months = dialog.querySelector(".dr-months"), apply = dialog.querySelector(".dr-apply");
  const status = dialog.querySelector(".dr-status");
  let timezone = "GMT+8", draft = {start:"", end:""}, firstMonth = "", focusDay = "", hoverDay = "";
  const format = (value, options)=>new Intl.DateTimeFormat("en-US", {timeZone:"UTC", ...options}).format(parseDate(value));
  const shortDate = value=>format(value, {month:"short", day:"numeric", year:"numeric"});
  const fullDate = value=>format(value, {weekday:"long", month:"long", day:"numeric", year:"numeric"});
  function rangeLabel(start, end){
    if(!start && !end) return "Date range";
    if(start === end) return shortDate(start);
    if(!start) return "Until " + shortDate(end);
    if(!end) return "From " + shortDate(start);
    const sameYear = start.slice(0,4) === end.slice(0,4);
    return format(start, {month:"short", day:"numeric", ...(sameYear ? {} : {year:"numeric"})}) + " – " + shortDate(end);
  }
  function sync(){
    label.textContent = rangeLabel(from.value, to.value);
    trigger.classList.toggle("has-range", !!(from.value || to.value));
    trigger.setAttribute("aria-label", "Date range" + (from.value || to.value ? ": " + label.textContent : "") + ", " + timezone);
    if(!dialog.hidden) close(false);
  }
  function position(){
    if(dialog.hidden) return;
    const bounds = trigger.getBoundingClientRect(), margin = 12;
    const width = dialog.offsetWidth, height = dialog.offsetHeight;
    const left = Math.max(margin, Math.min(bounds.left, root.innerWidth - width - margin));
    const below = bounds.bottom + 8;
    const top = below + height <= root.innerHeight - margin ? below : Math.max(margin, bounds.top - height - 8);
    dialog.style.left = left + "px";
    dialog.style.top = top + "px";
  }
  function ensureVisible(date){
    const key = monthStart(date);
    if(key !== firstMonth) firstMonth = key;
  }
  function paintRange(){
    const choosingEnd = !!draft.start && !draft.end;
    const preview = choosingEnd && hoverDay ? selectDate(draft, hoverDay) : draft;
    dialog.querySelectorAll(".dr-day").forEach(button=>{
      const date = button.dataset.date;
      const start = date === draft.start, end = date === draft.end;
      const between = preview.start && preview.end && date >= preview.start && date <= preview.end;
      button.classList.toggle("is-start", start);
      button.classList.toggle("is-end", end);
      button.classList.toggle("is-in-range", !!between && !start && !end);
      button.classList.toggle("is-preview", choosingEnd && !!between && !start);
      button.classList.toggle("is-awaiting", choosingEnd && !hoverDay);
      button.parentElement.setAttribute("aria-selected", String(start || end || !!between && !choosingEnd));
      button.setAttribute("aria-label", fullDate(date) + (start ? ", start date" : "") + (end ? ", end date" : ""));
    });
    ["start","end"].forEach(endpoint=>{
      const box = dialog.querySelector('[data-endpoint="' + endpoint + '"]'), value = box.querySelector(".dr-selection-value");
      value.textContent = draft[endpoint] ? shortDate(draft[endpoint]) : "Select date";
      value.classList.toggle("is-empty", !draft[endpoint]);
      box.classList.toggle("is-next", !draft.end && (endpoint === "start" ? !draft.start : !!draft.start));
    });
    status.textContent = draft.end ? "Range selected" : choosingEnd ? "Select end date" : "Select start date";
    apply.disabled = choosingEnd;
  }
  function renderMonths(){
    const today = todayInZone(timezone);
    const weekdayLabels = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    const weekdayShort = ["M","T","W","T","F","S","S"];
    let markup = '<button type="button" class="dr-nav dr-prev" aria-label="Previous month">' + icon('m14 6-6 6 6 6') + '</button>'
      + '<button type="button" class="dr-nav dr-next" aria-label="Next month">' + icon('m10 6 6 6-6 6') + '</button>';
    const heading = format(firstMonth, {month:"long", year:"numeric"});
    markup += '<section class="dr-month"><h3 class="dr-month-title" id="dateMonth">' + heading + '</h3><table class="dr-calendar" role="grid" aria-labelledby="dateMonth"><thead><tr>'
      + weekdayLabels.map((day,i)=>'<th scope="col" aria-label="' + day + '">' + weekdayShort[i] + '</th>').join("") + '</tr></thead><tbody>';
    const days = calendarDays(firstMonth);
    for(let week = 0; week < 6; week++){
      const weekDays = days.slice(week * 7, week * 7 + 7);
      if(!weekDays.some(Boolean)) break;
      markup += '<tr>' + weekDays.map(date=>date
        ? '<td role="gridcell" aria-selected="false"><button type="button" class="dr-day' + (date === today ? ' is-today' : '') + '" data-date="' + date + '" tabindex="' + (date === focusDay ? '0' : '-1') + '"' + (date === today ? ' aria-current="date"' : '') + '>' + Number(date.slice(-2)) + '</button></td>'
        : '<td role="gridcell"></td>').join("") + '</tr>';
    }
    markup += '</tbody></table></section>';
    months.innerHTML = markup;
    paintRange();
    position();
  }
  function focusDate(){
    const button = dialog.querySelector('[data-date="' + focusDay + '"]');
    if(button) button.focus({preventScroll:true});
  }
  function open(){
    draft = {start:from.value, end:to.value};
    hoverDay = "";
    focusDay = draft.start || todayInZone(timezone);
    firstMonth = monthStart(focusDay);
    dialog.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    renderMonths();
    focusDate();
  }
  function close(returnFocus = true){
    dialog.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if(returnFocus) trigger.focus({preventScroll:true});
  }
  trigger.addEventListener("click", ()=>dialog.hidden ? open() : close());
  dialog.querySelector(".dr-close").addEventListener("click", ()=>close());
  dialog.querySelector(".dr-clear").addEventListener("click", ()=>{
    draft = {start:"", end:""};
    hoverDay = "";
    paintRange();
  });
  apply.addEventListener("click", ()=>{
    if(apply.disabled) return;
    const changed = from.value !== draft.start || to.value !== draft.end;
    from.value = draft.start;
    to.value = draft.end;
    close();
    sync();
    // Both bounds are committed before a single filter refresh.
    if(changed) from.dispatchEvent(new Event("change", {bubbles:true}));
  });
  months.addEventListener("click", event=>{
    const day = event.target.closest(".dr-day"), nav = event.target.closest(".dr-nav");
    if(day){
      focusDay = day.dataset.date;
      draft = selectDate(draft, focusDay);
      hoverDay = "";
      months.querySelectorAll(".dr-day").forEach(button=>button.tabIndex = button === day ? 0 : -1);
      paintRange();
    }else if(nav){
      const next = nav.classList.contains("dr-next");
      firstMonth = shiftMonth(firstMonth, next ? 1 : -1);
      focusDay = firstMonth;
      hoverDay = "";
      renderMonths();
      dialog.querySelector(next ? ".dr-next" : ".dr-prev").focus();
    }
  });
  months.addEventListener("pointerover", event=>{
    const day = event.target.closest(".dr-day");
    if(day && draft.start && !draft.end){ hoverDay = day.dataset.date; paintRange(); }
  });
  months.addEventListener("pointerleave", ()=>{
    if(hoverDay){ hoverDay = ""; paintRange(); }
  });
  months.addEventListener("keydown", event=>{
    const button = event.target.closest(".dr-day");
    if(!button || event.ctrlKey || event.metaKey || event.altKey) return;
    const date = button.dataset.date, weekday = (parseDate(date).getUTCDay() + 6) % 7;
    let target;
    if(event.key === "ArrowLeft") target = addDays(date, -1);
    else if(event.key === "ArrowRight") target = addDays(date, 1);
    else if(event.key === "ArrowUp") target = addDays(date, -7);
    else if(event.key === "ArrowDown") target = addDays(date, 7);
    else if(event.key === "Home") target = addDays(date, -weekday);
    else if(event.key === "End") target = addDays(date, 6 - weekday);
    else if(event.key === "PageUp") target = shiftMonth(date, event.shiftKey ? -12 : -1);
    else if(event.key === "PageDown") target = shiftMonth(date, event.shiftKey ? 12 : 1);
    if(!target) return;
    event.preventDefault();
    focusDay = target;
    if(draft.start && !draft.end) hoverDay = target;
    ensureVisible(target);
    renderMonths();
    focusDate();
  });
  document.addEventListener("keydown", event=>{
    if(event.key === "Escape" && !dialog.hidden){ event.preventDefault(); close(); }
  });
  document.addEventListener("pointerdown", event=>{
    if(!dialog.hidden && !dialog.contains(event.target) && !trigger.contains(event.target)) close();
  });
  document.addEventListener("focusin", event=>{
    if(!dialog.hidden && !dialog.contains(event.target) && !trigger.contains(event.target)) close(false);
  });
  [from,to].forEach(input=>input.addEventListener("change", sync));
  root.addEventListener("resize", ()=>{
    if(!dialog.hidden){ ensureVisible(focusDay); renderMonths(); }
  });
  root.addEventListener("scroll", position, true);
  root.DateRangePicker = {
    sync,
    setTimezone(value){
      timezone = Object.prototype.hasOwnProperty.call(ZONES, value) ? value : "GMT+8";
      document.getElementById("dateRangeZone").textContent = timezone;
      sync();
    }
  };
  sync();
})(typeof window !== "undefined" ? window : globalThis);
