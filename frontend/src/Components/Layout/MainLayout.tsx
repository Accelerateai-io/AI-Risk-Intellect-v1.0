import mainLogo from "../../assets/images/mainlogo.svg";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { isSidebarNavItemActive, SIDEBAR_NAV } from "./sidebarNav";
import { TopBar } from "./TopBar";
import { usePendingReviewCount } from "../../utils/usePendingReviewCount";
import "./mainLayout.css";

const NAV_ICON_PROPS = {
  size: 20,
  strokeWidth: 1.75,
  className: "mainLayout__navIcon",
  "aria-hidden": true as const,
};

export function MainLayout() {
  const { pathname } = useLocation();
  const pendingReviewCount = usePendingReviewCount();

  return (
    <div className="mainLayout">
      <aside className="mainLayout__sidebar" aria-label="Main navigation">
        <div className="mainLayout__brand">
          <img
            src={mainLogo}
            alt=""
            className="mainLayout__brandLogo"
            width={44}
            height={44}
          />
          <div className="mainLayout__brandText">
            <span className="mainLayout__brandTitle">AI-Q</span>
            <span className="mainLayout__brandTagline">AI RISK INTELLECT</span>
          </div>
        </div>
        <nav className="mainLayout__nav">
          {SIDEBAR_NAV.map((item) => {
            const Icon = item.icon;
            const showPendingBadge =
              item.to === "/review" && pendingReviewCount > 0;
            const pendingLabel =
              pendingReviewCount > 99 ? "99+" : String(pendingReviewCount);

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={() =>
                  `mainLayout__navLink${
                    isSidebarNavItemActive(pathname, item.to)
                      ? " mainLayout__navLink--active"
                      : ""
                  }`
                }
                aria-label={
                  showPendingBadge
                    ? `${item.label}, ${pendingReviewCount} pending review${pendingReviewCount === 1 ? "" : "s"}`
                    : item.label
                }
              >
                <Icon {...NAV_ICON_PROPS} />
                <span className="mainLayout__navLabel">{item.label}</span>
                {showPendingBadge ? (
                  <span className="mainLayout__navBadge" aria-hidden>
                    {pendingLabel}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <div className="mainLayout__main">
        <TopBar />
        <div className="mainLayout__scroll">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
