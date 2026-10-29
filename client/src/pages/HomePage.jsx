import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUpRight, Building2, CalendarDays, Check, Compass, Cpu, FlaskConical, Hammer, Layers3, ShieldCheck, Sparkles, Users } from 'lucide-react';

const categories = [
  { icon: Cpu, label: 'Computing', detail: 'Workstations, boards & more', color: 'mint' },
  { icon: FlaskConical, label: 'Lab equipment', detail: 'Tools for your next experiment', color: 'yellow' },
  { icon: Hammer, label: 'Workshop', detail: 'Make something real', color: 'pink' },
  { icon: Building2, label: 'Spaces', detail: 'Rooms to think and work', color: 'blue' },
];

const steps = [
  { n: '01', title: 'Find what you need', text: 'Browse equipment and spaces shared by departments across campus.' },
  { n: '02', title: 'Check your access', text: 'See availability and any training or eligibility requirements up front.' },
  { n: '03', title: 'Make it happen', text: 'Request a time, pick it up, and return it when you’re done.' },
];

export default function HomePage() {
  return (
    <main className="home-page">
      <header className="home-nav">
        <Link to="/" className="home-brand" aria-label="CampusCommons home">
          <span className="home-brand-mark">CC</span>
          <span>Campus<span className="home-brand-light">Commons</span></span>
        </Link>
        <nav className="home-nav-links" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#what-you-can-find">Explore resources</a>
        </nav>
        <div className="home-nav-actions">
          <Link to="/login" className="home-login">Log in</Link>
          <Link to="/register" className="home-button home-button-dark">Join your campus <ArrowUpRight size={16} /></Link>
        </div>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <div className="home-eyebrow"><span className="home-eyebrow-dot" /> MADE FOR THE MAKERS, THINKERS & DOERS</div>
          <h1>Your campus has<br />more to <span>offer.</span></h1>
          <p className="home-hero-text">A 3D printer for your prototype. A lab for your big question. A room for your team to figure it out. Find it, book it, make it yours.</p>
          <div className="home-hero-actions">
            <Link to="/register" className="home-button home-button-red">Get started <ArrowRight size={17} /></Link>
            <Link to="/login" className="home-quiet-link">I already have an account <ArrowUpRight size={15} /></Link>
          </div>
          <div className="home-trust"><span className="home-trust-icon"><ShieldCheck size={17} /></span><span>For your campus community</span><span className="home-trust-sep">·</span><span>Every booking, accounted for</span></div>
        </div>

        <div className="home-hero-art" aria-label="Illustration of shared campus equipment">
          <div className="home-art-sticker sticker-note"><Sparkles size={16} /> BIG IDEAS<br />START HERE</div>
          <div className="home-art-sun" />
          <div className="home-art-grid" />
          <div className="home-art-card">
            <div className="home-art-card-top"><span className="home-art-live"><i /> AVAILABLE TODAY</span><span className="home-art-dots">•••</span></div>
            <div className="home-printer">
              <div className="printer-spool"><span /></div><div className="printer-frame"><i className="printer-leg left"/><i className="printer-leg right"/><i className="printer-bar"/><i className="printer-head"/><i className="printer-bed"/><i className="printer-object"/></div>
            </div>
            <div className="home-art-card-info"><div><span className="home-mini-label">DESIGN & INNOVATION CENTRE</span><h3>3D Printer</h3></div><span className="home-art-arrow"><ArrowUpRight size={18} /></span></div>
            <div className="home-art-card-foot"><span><CalendarDays size={14} /> Pick a time</span><span className="home-art-availability"><Check size={13} /> Ready to book</span></div>
          </div>
          <div className="home-art-sticker sticker-book"><span className="sticker-book-icon"><Layers3 size={17} /></span><span>Shared by<br /><b>your campus</b></span></div>
          <div className="home-art-caption"><span>01 / 04</span><span className="caption-line"/><span>FIND YOUR NEXT TOOL</span></div>
        </div>
        <a href="#what-you-can-find" className="home-scroll-cue"><ArrowDown size={15} /> SCROLL TO EXPLORE</a>
      </section>

      <section className="home-category-section" id="what-you-can-find">
        <div className="home-section-heading"><div><span className="home-kicker">A WHOLE CAMPUS, OPEN TO YOU</span><h2>What are you looking for?</h2></div><Link to="/explore" className="home-text-link">See what’s available <ArrowUpRight size={16} /></Link></div>
        <div className="home-category-grid">{categories.map(({ icon: Icon, label, detail, color }, i) => <Link to="/login" className="home-category-card" key={label}><div className={`home-category-icon ${color}`}><Icon size={22} strokeWidth={1.8} /></div><span className="home-category-number">0{i + 1}</span><h3>{label}</h3><p>{detail}</p><ArrowUpRight className="home-category-arrow" size={17} /></Link>)}</div>
      </section>

      <section className="home-how" id="how-it-works">
        <div className="home-how-intro"><span className="home-kicker">LESS SEARCHING. MORE DOING.</span><h2>From “I wonder if…”<br />to <em>“look what I made.”</em></h2><p>CampusCommons connects you to the things your campus already has, so your next good idea doesn’t have to wait.</p><Link to="/register" className="home-button home-button-dark">Find your next resource <ArrowRight size={16} /></Link></div>
        <div className="home-steps">{steps.map((step) => <article className="home-step" key={step.n}><span className="home-step-number">{step.n}</span><div><h3>{step.title}</h3><p>{step.text}</p></div><ArrowUpRight className="home-step-arrow" size={17} /></article>)}</div>
        <div className="home-how-stamp"><Users size={18} /><span>GOOD THINGS<br /><b>ARE BETTER SHARED</b></span></div>
      </section>

      <section className="home-share-section">
        <div className="home-share-heading">
          <span className="home-kicker">A BETTER WAY TO SHARE</span>
          <h2>Good resources<br /><em>should get around.</em></h2>
          <p>Useful equipment can sit idle in one corner of campus while someone else is waiting to use it. CampusCommons helps your community put those resources to work.</p>
          <Link to="/explore" className="home-text-link">Explore the catalogue <ArrowRight size={16} /></Link>
        </div>
        <div className="home-benefit-list">
          <article className="home-benefit"><span className="home-benefit-icon"><Compass size={22} /></span><div><span className="home-benefit-label">FOR THE CURIOUS</span><h3>Know what’s available</h3><p>Find equipment and spaces across campus, with the details you need before you book.</p></div><span className="home-benefit-count">01</span></article>
          <article className="home-benefit"><span className="home-benefit-icon coral"><ShieldCheck size={22} /></span><div><span className="home-benefit-label">FOR THE PREPARED</span><h3>Clear requirements</h3><p>See training, access rules, and approval steps up front. No surprises after you request.</p></div><span className="home-benefit-count">02</span></article>
          <article className="home-benefit"><span className="home-benefit-icon gold"><CalendarDays size={22} /></span><div><span className="home-benefit-label">FOR THE GETTING-IT-DONE</span><h3>One place to keep track</h3><p>Follow your request, booking, and return from a single account.</p></div><span className="home-benefit-count">03</span></article>
        </div>
      </section>

      <section className="home-about-section" id="about-campuscommons">
        <div className="home-about-top"><span className="home-kicker">ONE SHARED CAMPUS CATALOGUE</span><h2>CampusCommons makes<br /><em>sharing work.</em></h2><p>Departments and facilities can list equipment, rooms, and computing resources in one place. Campus members can find what they need, understand who can use it, and follow each request from start to finish.</p></div>
        <div className="home-about-columns">
          <article className="home-about-card"><span className="home-about-index">01 / FIND</span><div className="home-about-icon"><Compass size={23} /></div><h3>Discover resources across campus</h3><p>Search by name, category, or department. Each listing can show its location, opening hours, availability, and booking method, so you can make a good choice before you ask.</p><Link to="/explore" className="home-about-link">Browse the catalogue <ArrowRight size={15} /></Link></article>
          <article className="home-about-card"><span className="home-about-index">02 / QUALIFY</span><div className="home-about-icon coral"><ShieldCheck size={23} /></div><h3>See access rules before booking</h3><p>Some resources need staff approval, a specific member type, or a training badge. CampusCommons explains what is required and points you toward the next step.</p><Link to="/register" className="home-about-link">Create your account <ArrowRight size={15} /></Link></article>
          <article className="home-about-card"><span className="home-about-index">03 / KEEP TRACK</span><div className="home-about-icon gold"><CalendarDays size={23} /></div><h3>Follow a request through return</h3><p>See whether a request is awaiting review, approved, or in use. Check-in and return steps help borrowers and resource teams stay on the same page.</p><Link to="/login" className="home-about-link">Sign in to continue <ArrowRight size={15} /></Link></article>
        </div>
        <div className="home-about-note"><span className="home-about-check"><Check size={17} /></span><p><strong>Built for accountable sharing.</strong> Listings can set fair-use limits and eligibility requirements; bookings keep a clear record of requests, handovers, and returns.</p></div>
      </section>

      <section className="home-provider-cta">
        <div className="home-provider-art" aria-hidden="true"><div className="provider-circle"><Building2 size={42} strokeWidth={1.3} /></div><span className="provider-spark spark-a">✳</span><span className="provider-spark spark-b">✳</span><span className="provider-square" /></div>
        <div className="home-provider-copy"><span className="home-kicker">FOR DEPARTMENTS & RESOURCE TEAMS</span><h2>Have something<br />worth sharing?</h2><p>Make equipment and spaces easier to discover. List a resource, set the access rules, and keep requests organized.</p><Link to="/login" className="home-button home-button-dark">Sign in to manage resources <ArrowRight size={16} /></Link></div>
        <span className="home-provider-note">YOUR NEXT COLLABORATION<br />MIGHT START HERE ↗</span>
      </section>

      <footer className="home-footer"><Link to="/" className="home-brand"><span className="home-brand-mark">CC</span><span>Campus<span className="home-brand-light">Commons</span></span></Link><span>Built for the things you’re here to make.</span><Link to="/login" className="home-footer-link">Campus sign in <ArrowUpRight size={14} /></Link></footer>
    </main>
  );
}
